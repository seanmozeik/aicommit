import { Effect } from 'effect';

import { CodexCliError as CodexCliErrorClass } from './errors/index';
import { buildSystemPrompt } from './prompt';

const CODEX_MODEL = 'gpt-5.4-mini';
const CODEX_REASONING_EFFORT = 'low';
const CODEX_OUTPUT_SCHEMA = JSON.stringify({
  additionalProperties: false,
  properties: {
    message: {
      description: 'A single conventional commit subject, at most 72 characters.',
      type: 'string',
    },
  },
  required: ['message'],
  type: 'object',
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const parseCodexOutput = (text: string): string => {
  const trimmed = text.trim();
  if (trimmed === '') {
    return '';
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (isRecord(parsed) && typeof parsed['message'] === 'string') {
      return parsed['message'].trim();
    }
  } catch {
    return trimmed;
  }
  return trimmed;
};

const readStreamText = (stream: ReadableStream<Uint8Array>): Effect.Effect<string> =>
  Effect.promise(async () => {
    try {
      return await new Response(stream).text();
    } catch {
      return '';
    }
  });

const codexPaths = (): { readonly outputPath: string; readonly schemaPath: string } => ({
  outputPath: `/tmp/aicommit-codex-output-${crypto.randomUUID()}.json`,
  schemaPath: `/tmp/aicommit-codex-schema-${crypto.randomUUID()}.json`,
});

const codexArgs = (schemaPath: string, outputPath: string): string[] => [
  'exec',
  '--model',
  CODEX_MODEL,
  '--config',
  `model_reasoning_effort="${CODEX_REASONING_EFFORT}"`,
  '--sandbox',
  'read-only',
  '--ask-for-approval',
  'never',
  '--ephemeral',
  '--ignore-rules',
  '--color',
  'never',
  '--output-schema',
  schemaPath,
  '--output-last-message',
  outputPath,
  '-',
];

const writeCodexSchema = (schemaPath: string): Effect.Effect<void, CodexCliErrorClass> =>
  Effect.tryPromise({
    catch: (error) =>
      new CodexCliErrorClass({
        exitCode: -1,
        message: `Failed to write Codex schema: ${error instanceof Error ? error.message : String(error)}`,
      }),
    try: async () => {
      await Bun.write(schemaPath, CODEX_OUTPUT_SCHEMA);
    },
  });

const writeCodexPrompt = (
  proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'>,
  prompt: string,
): Effect.Effect<void, CodexCliErrorClass> =>
  Effect.tryPromise({
    catch: (error) =>
      new CodexCliErrorClass({
        exitCode: -1,
        message: `Failed to write Codex prompt: ${error instanceof Error ? error.message : String(error)}`,
      }),
    try: async () => {
      await proc.stdin.write(`${buildSystemPrompt()}\n\n${prompt}`);
      await proc.stdin.end();
    },
  });

const generateWithCodex = (prompt: string): Effect.Effect<string, CodexCliErrorClass> =>
  Effect.gen(function* generateWithCodexImpl() {
    yield* Effect.logInfo('Generating with Codex CLI');
    const { outputPath, schemaPath } = codexPaths();
    yield* writeCodexSchema(schemaPath);
    const proc = Bun.spawn(['codex', ...codexArgs(schemaPath, outputPath)], {
      stderr: 'pipe',
      stdin: 'pipe',
      stdout: 'pipe',
    });
    yield* writeCodexPrompt(proc, prompt);
    const exitCode = yield* Effect.tryPromise({
      catch: (error) =>
        new CodexCliErrorClass({
          exitCode: -1,
          message: `Failed to get Codex exit code: ${error instanceof Error ? error.message : String(error)}`,
        }),
      try: () => proc.exited,
    });
    if (exitCode !== 0) {
      const stderr = yield* readStreamText(proc.stderr);
      yield* Effect.logError(`Codex CLI failed: ${stderr.trim() || `exit code ${exitCode}`}`);
      return yield* new CodexCliErrorClass({
        exitCode,
        message: stderr.trim() || `Codex CLI exited with code ${exitCode}`,
      });
    }
    const output = yield* Effect.tryPromise({
      catch: (error) =>
        new CodexCliErrorClass({
          exitCode,
          message: `Failed to read Codex output: ${error instanceof Error ? error.message : String(error)}`,
        }),
      try: () => Bun.file(outputPath).text(),
    });
    const result = parseCodexOutput(output);
    yield* Effect.logInfo('Codex CLI generation succeeded');
    return result;
  }).pipe(Effect.withSpan('ai.codex.generate'));

export { generateWithCodex };
