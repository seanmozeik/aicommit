import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Duration, Effect, type Scope } from 'effect';

import { buildSystemPrompt } from '../commit/prompt';
import { CodexCliError as CodexCliErrorClass } from '../errors/codex-cli-error';
import { TimeoutError } from '../errors/timeout-error';
import { acquireProcess, CLI_GENERATION_TIMEOUT_MS } from './cli-process';

const DEFAULT_CODEX_MODEL = 'gpt-5.4-mini';
const DEFAULT_CODEX_REASONING_EFFORT = 'low';
const COMMIT_OUTPUT_DESCRIPTION = 'A single conventional commit subject, at most 72 characters.';

const codexOutputSchema = (description: string): string =>
  JSON.stringify({
    additionalProperties: false,
    properties: { message: { description, type: 'string' } },
    required: ['message'],
    type: 'object',
  });

const parseCodexOutput = (text: string): string => {
  const trimmed = text.trim();
  if (trimmed === '') {
    return '';
  }
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'message' in parsed &&
      typeof parsed.message === 'string'
    ) {
      return parsed.message.trim();
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

type CodexReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

interface CodexModelOptions {
  readonly model?: string;
  readonly reasoningEffort?: CodexReasoningEffort;
  readonly serviceTier?: 'fast';
}

interface CodexGenerationOptions extends CodexModelOptions {
  readonly command?: (schemaPath: string, outputPath: string) => readonly string[];
  readonly outputDescription?: string;
  readonly systemPrompt?: string;
  readonly tempDirectory?: string;
  readonly timeoutMs?: number;
}

interface CodexPaths {
  readonly directory: string;
  readonly outputPath: string;
  readonly schemaPath: string;
}

const acquireCodexPaths = (
  tempDirectory: string,
): Effect.Effect<CodexPaths, CodexCliErrorClass, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.tryPromise({
      catch: (error) =>
        new CodexCliErrorClass({
          exitCode: -1,
          message: `Failed to create Codex temporary directory: ${error instanceof Error ? error.message : String(error)}`,
        }),
      try: async () => {
        const directory = await mkdtemp(path.join(tempDirectory, 'aicommit-codex-'));
        return {
          directory,
          outputPath: path.join(directory, 'output.json'),
          schemaPath: path.join(directory, 'schema.json'),
        };
      },
    }),
    ({ directory }) =>
      Effect.tryPromise(() => rm(directory, { force: true, recursive: true })).pipe(
        Effect.catch((error) =>
          Effect.logWarning(
            `Failed to remove Codex temporary directory ${directory}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        ),
      ),
  );

const buildCodexArgs = (
  schemaPath: string,
  outputPath: string,
  options: CodexModelOptions = {},
): string[] => [
  '--ask-for-approval',
  'never',
  ...(options.serviceTier === 'fast' ? ['--enable', 'fast_mode'] : []),
  'exec',
  '--model',
  options.model ?? DEFAULT_CODEX_MODEL,
  '--config',
  `model_reasoning_effort="${options.reasoningEffort ?? DEFAULT_CODEX_REASONING_EFFORT}"`,
  ...(options.serviceTier === 'fast' ? ['--config', 'service_tier="fast"'] : []),
  '--sandbox',
  'read-only',
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

const writeCodexSchema = (
  schemaPath: string,
  outputDescription: string,
): Effect.Effect<void, CodexCliErrorClass> =>
  Effect.tryPromise({
    catch: (error) =>
      new CodexCliErrorClass({
        exitCode: -1,
        message: `Failed to write Codex schema: ${error instanceof Error ? error.message : String(error)}`,
      }),
    try: async () => {
      await Bun.write(schemaPath, codexOutputSchema(outputDescription));
    },
  });

const writeCodexPrompt = (
  proc: Bun.Subprocess<'pipe', 'pipe', 'pipe'>,
  prompt: string,
  systemPrompt: string,
): Effect.Effect<void, CodexCliErrorClass> =>
  Effect.tryPromise({
    catch: (error) =>
      new CodexCliErrorClass({
        exitCode: -1,
        message: `Failed to write Codex prompt: ${error instanceof Error ? error.message : String(error)}`,
      }),
    try: async () => {
      await proc.stdin.write(`${systemPrompt}\n\n${prompt}`);
      await proc.stdin.end();
    },
  });

const generateWithCodex = (
  prompt: string,
  options: CodexGenerationOptions = {},
): Effect.Effect<string, CodexCliErrorClass | TimeoutError> =>
  Effect.gen(function* generateWithCodexImpl() {
    const model = options.model ?? DEFAULT_CODEX_MODEL;
    yield* Effect.logInfo('Generating with Codex CLI');
    yield* Effect.annotateCurrentSpan({ 'ai.model': model, 'ai.provider': 'codex-cli' });
    const { outputPath, schemaPath } = yield* acquireCodexPaths(options.tempDirectory ?? tmpdir());
    yield* writeCodexSchema(schemaPath, options.outputDescription ?? COMMIT_OUTPUT_DESCRIPTION);
    const proc = yield* acquireProcess(
      options.command?.(schemaPath, outputPath) ?? [
        'codex',
        ...buildCodexArgs(schemaPath, outputPath, options),
      ],
      (error) =>
        new CodexCliErrorClass({
          exitCode: -1,
          message: `Failed to start Codex CLI: ${error instanceof Error ? error.message : String(error)}`,
        }),
    );
    yield* writeCodexPrompt(proc, prompt, options.systemPrompt ?? buildSystemPrompt());
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
  }).pipe(
    Effect.scoped,
    Effect.timeoutOrElse({
      duration: Duration.millis(options.timeoutMs ?? CLI_GENERATION_TIMEOUT_MS),
      orElse: () =>
        new TimeoutError({
          message: 'Codex CLI generation timed out',
          timeoutMs: options.timeoutMs ?? CLI_GENERATION_TIMEOUT_MS,
        }),
    }),
    Effect.withSpan('ai.codex.generate'),
  );

export { buildCodexArgs, generateWithCodex };
export type { CodexGenerationOptions, CodexModelOptions, CodexReasoningEffort };
