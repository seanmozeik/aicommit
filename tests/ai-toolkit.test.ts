import * as BunTest from 'bun:test';

import { Effect, Layer, Schema } from 'effect';
import { Tool, Toolkit } from 'effect/unstable/ai';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';

import { generateWithToolkit } from '../src/ai/toolkit';
import type { OpenAiCompatiblePreset } from '../src/config/secrets';

const RequestBodySchema = Schema.Struct({
  max_tokens: Schema.Finite,
  model: Schema.String,
  temperature: Schema.optionalKey(Schema.Finite),
});
const RequestBodyJson = Schema.fromJsonString(RequestBodySchema);

interface CapturedRequest {
  readonly body: typeof RequestBodySchema.Type;
  readonly path: string;
  readonly receivedAt: number;
}

interface SequenceResponse {
  readonly body: object;
  readonly status: number;
}

interface MemoryTransport {
  readonly layer: Layer.Layer<HttpClient.HttpClient>;
  readonly requests: CapturedRequest[];
}

const successfulToolResponse = () => ({
  choices: [
    {
      finish_reason: 'tool_calls',
      index: 0,
      message: {
        content: null,
        role: 'assistant',
        tool_calls: [
          {
            function: { arguments: '{"value":"ok"}', name: 'SubmitResult' },
            id: 'call_1',
            type: 'function',
          },
        ],
      },
    },
  ],
  created: 1,
  id: 'response_1',
  model: 'test-model',
});

const requestBodyText = (request: Parameters<typeof HttpClientResponse.fromWeb>[0]): string => {
  if (request.body._tag !== 'Uint8Array') {
    throw new TypeError(`Expected JSON request body, received ${request.body._tag}`);
  }
  return new TextDecoder().decode(request.body.body);
};

const memoryTransport = (responses: readonly SequenceResponse[]): MemoryTransport => {
  const requests: CapturedRequest[] = [];
  let responseIndex = 0;
  const client = HttpClient.make((request, url) =>
    Effect.gen(function* memoryRequest() {
      const body = yield* Schema.decodeEffect(RequestBodyJson)(requestBodyText(request)).pipe(
        Effect.orDie,
      );
      requests.push({ body, path: url.pathname, receivedAt: performance.now() });
      const response = responses[Math.min(responseIndex, responses.length - 1)] ?? {
        body: { error: { message: 'Missing test response' } },
        status: 500,
      };
      responseIndex += 1;
      return HttpClientResponse.fromWeb(
        request,
        Response.json(response.body, { status: response.status }),
      );
    }),
  );
  return { layer: Layer.succeed(HttpClient.HttpClient, client), requests };
};

const SubmitResult = Tool.make('SubmitResult', {
  description: 'Return the test result.',
  failureMode: 'return',
  parameters: Schema.Struct({ value: Schema.String }),
  success: Schema.Struct({ ok: Schema.Literal(true) }),
});
const ContractToolkit = Toolkit.make(SubmitResult);
const ContractToolkitLayer = ContractToolkit.toLayer(
  Effect.succeed(ContractToolkit.of({ SubmitResult: () => Effect.succeed({ ok: true as const }) })),
);

const runGeneration = (preset: OpenAiCompatiblePreset, transport: MemoryTransport, attempts = 2) =>
  generateWithToolkit({
    attempts,
    extractFromCalls: (calls) => (calls.length === 1 ? 'ok' : null),
    maxOutputTokens: 321,
    preset,
    systemPrompt: 'Use the SubmitResult tool.',
    toolkit: ContractToolkit.pipe(Effect.provide(ContractToolkitLayer)),
    transportLayer: transport.layer,
    userPrompt: 'Return ok.',
  });

const customPreset = (): OpenAiCompatiblePreset => ({
  apiKey: 'test-only',
  baseUrl: 'https://provider.invalid',
  model: 'legacy-model',
});

BunTest.test('custom API request retains temperature', async () => {
  const transport = memoryTransport([{ body: successfulToolResponse(), status: 200 }]);
  await Effect.runPromise(runGeneration(customPreset(), transport));

  BunTest.expect(transport.requests[0]?.path).toBe('/v1/chat/completions');
  BunTest.expect(transport.requests[0]?.body).toEqual({
    max_tokens: 321,
    model: 'legacy-model',
    temperature: 0.2,
  });
});

BunTest.test(
  'deterministic HTTP 400 is attempted once and preserves response context',
  async () => {
    const responseBody = { error: { message: 'invalid request', type: 'invalid_request_error' } };
    const transport = memoryTransport([{ body: responseBody, status: 400 }]);
    const failure = await Effect.runPromise(
      runGeneration(customPreset(), transport).pipe(Effect.flip),
    );

    BunTest.expect(transport.requests).toHaveLength(1);
    BunTest.expect(failure._tag).toBe('OpenAiApiError');
    if (failure._tag === 'OpenAiApiError') {
      BunTest.expect(failure.statusCode).toBe(400);
      BunTest.expect(failure.responseBody).toContain('invalid request');
    }
  },
);

BunTest.test('transient HTTP 500 retries after a non-zero bounded delay', async () => {
  const transport = memoryTransport([
    { body: { error: { message: 'try again', type: 'server_error' } }, status: 500 },
    { body: successfulToolResponse(), status: 200 },
  ]);
  const result = await Effect.runPromise(runGeneration(customPreset(), transport));

  BunTest.expect(result).toBe('ok');
  BunTest.expect(transport.requests).toHaveLength(2);
  const [first, second] = transport.requests;
  BunTest.expect(first).toBeDefined();
  BunTest.expect(second).toBeDefined();
  if (first !== undefined && second !== undefined) {
    BunTest.expect(second.receivedAt - first.receivedAt).toBeGreaterThanOrEqual(15);
    BunTest.expect(second.receivedAt - first.receivedAt).toBeLessThan(1000);
  }
});
