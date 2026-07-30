/**
 * Local Model Runtime Adapter
 *
 * Bridges `@huggingface/transformers` local inference to the framework's
 * current model runtime substrate. This allows `streamText()` and
 * `generateText()` to work with local models seamlessly.
 *
 * @module extensions/ext-llm-transformers
 */

import {
  generate,
  generateStream,
  validateGenerateOptions,
  verifyLocalRuntime,
} from "./local-engine.ts";
import type {
  ChatMessage,
  GenerateOptions,
  LocalGenerationFinishReason,
  LocalGenerationResult,
} from "./local-engine.ts";
import { LocalGenerationCleanupError } from "./local-engine.ts";
import { DEFAULT_LOCAL_MODEL, resolveLocalModel } from "./model-catalog.ts";
import { linkAbortSignals, type LocalRuntimeLifecycle } from "./runtime-lifecycle.ts";
import { serverLogger } from "veryfront/utils";
import { fromError } from "veryfront/errors";
import type {
  ModelRuntime,
  ModelRuntimeCallOptions,
  ModelRuntimePromptMessage,
  RuntimeAssistantContentPart,
} from "veryfront/provider/types";

const logger = serverLogger.component("local-llm");

/** Default maximum new tokens for local model generation */
const DEFAULT_MAX_NEW_TOKENS = 512;

/**
 * Local runtimes also accept the legacy string shorthand for user and
 * assistant messages. Canonical runtime messages remain the primary contract.
 */
export type LocalPromptMessage =
  | ModelRuntimePromptMessage
  | {
    role: string;
    content: string | ReadonlyArray<{ type: string; text?: string }>;
  };

/**
 * Convert model-runtime prompt format to simple ChatMessage array.
 *
 * The prompt is an array of message objects with role and content arrays.
 * We extract text content for the local model.
 */
function convertPrompt(prompt: ReadonlyArray<LocalPromptMessage>): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (const msg of prompt) {
    if (
      msg.role !== "system" &&
      msg.role !== "user" &&
      msg.role !== "assistant"
    ) {
      throw new TypeError(
        `Local models do not support prompt role "${msg.role}"`,
      );
    }

    let text = "";
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (
          part.type !== "text" ||
          !("text" in part) ||
          typeof part.text !== "string"
        ) {
          throw new TypeError(
            `Local models do not support prompt content type "${part.type}"`,
          );
        }
        text += part.text;
      }
    } else {
      throw new TypeError("Local model prompt content must be text");
    }

    if (text.length === 0) {
      throw new TypeError("Local model prompt messages must contain text");
    }
    messages.push({ role: msg.role, content: text });
  }

  if (messages.length === 0) {
    throw new TypeError("Local model prompt must contain at least one message");
  }

  return messages;
}

export type LocalModelCallOptions = Omit<ModelRuntimeCallOptions, "prompt"> & {
  prompt: ReadonlyArray<LocalPromptMessage>;
};

export interface LocalModelRuntimeEngine {
  prepare?(modelId: string, abortSignal?: AbortSignal): Promise<void>;
  generate(
    modelId: string,
    messages: ChatMessage[],
    options: GenerateOptions,
  ): Promise<LocalGenerationResult>;
  generateStream(
    modelId: string,
    messages: ChatMessage[],
    options: GenerateOptions,
  ): AsyncIterable<string> & {
    [Symbol.asyncIterator](): AsyncIterator<string, LocalGenerationFinishReason>;
  };
}

const defaultLocalModelRuntimeEngine: LocalModelRuntimeEngine = {
  prepare: (modelId, abortSignal) => verifyLocalRuntime(modelId, abortSignal),
  generate,
  generateStream,
};

/** Map model-runtime generation options to local engine GenerateOptions. */
function toGenerateOptions(options: LocalModelCallOptions): GenerateOptions {
  validateLocalCallOptions(options);
  return validateGenerateOptions({
    maxNewTokens: options.maxOutputTokens ?? DEFAULT_MAX_NEW_TOKENS,
    temperature: options.temperature ?? 0.7,
    topP: options.topP,
    topK: options.topK,
    stopSequences: options.stopSequences === undefined ? undefined : [...options.stopSequences],
    abortSignal: options.abortSignal,
  });
}

function throwUnsupportedOption(name: string): never {
  throw new TypeError(`Local models do not support the ${name} option`);
}

function validateOptionalNumber(name: string, value: unknown): void {
  if (value !== undefined && typeof value !== "number") {
    throw new TypeError(`${name} must be a number`);
  }
}

function validateLocalCallOptions(options: LocalModelCallOptions): void {
  validateOptionalNumber("maxOutputTokens", options.maxOutputTokens);
  validateOptionalNumber("temperature", options.temperature);
  validateOptionalNumber("topP", options.topP);
  validateOptionalNumber("topK", options.topK);
  if (options.stopSequences !== undefined && !Array.isArray(options.stopSequences)) {
    throw new TypeError("stopSequences must be an array of strings");
  }
  if (
    options.abortSignal !== undefined &&
    !(options.abortSignal instanceof AbortSignal)
  ) {
    throw new TypeError("abortSignal must be an AbortSignal");
  }
  if (options.tools !== undefined && (!Array.isArray(options.tools) || options.tools.length > 0)) {
    throwUnsupportedOption("tools");
  }
  if (options.toolChoice !== undefined) throwUnsupportedOption("toolChoice");
  if (options.seed !== undefined) throwUnsupportedOption("seed");
  if (options.presencePenalty !== undefined) throwUnsupportedOption("presencePenalty");
  if (options.frequencyPenalty !== undefined) throwUnsupportedOption("frequencyPenalty");
  if (options.headers !== undefined) throwUnsupportedOption("headers");
  if (options.providerOptions !== undefined) throwUnsupportedOption("providerOptions");
  if (options.reasoning !== undefined) throwUnsupportedOption("reasoning");
  if (
    options.includeRawChunks !== undefined &&
    typeof options.includeRawChunks !== "boolean"
  ) {
    throw new TypeError("includeRawChunks must be a boolean");
  }
  if (options.includeRawChunks) throwUnsupportedOption("includeRawChunks");
  if (options.userId !== undefined) throwUnsupportedOption("userId");
  if (options.responseFormat !== undefined) {
    if (
      typeof options.responseFormat !== "object" ||
      options.responseFormat === null ||
      Array.isArray(options.responseFormat)
    ) {
      throw new TypeError("responseFormat must be an object");
    }
    if (options.responseFormat.type !== "text") {
      throwUnsupportedOption("responseFormat");
    }
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

async function waitForAbortableGeneration<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return await promise;
  throwIfAborted(signal);

  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      reject(abortReason(signal));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function validateGenerationResult(value: unknown): LocalGenerationResult {
  if (
    typeof value !== "object" || value === null ||
    typeof (value as { text?: unknown }).text !== "string"
  ) {
    throw new TypeError("Local generation completed without text");
  }
  const finishReason = (value as { finishReason?: unknown }).finishReason;
  if (finishReason !== "stop" && finishReason !== "length") {
    throw new TypeError("Local generation completed without a valid finish reason");
  }
  return {
    text: (value as { text: string }).text,
    finishReason,
  };
}

/**
 * Create a local model runtime for the given model ID.
 *
 * The returned object implements the current runtime interface, making it
 * compatible with the framework execution path and related hooks.
 */
export function createLocalModelRuntime(
  modelId: string | undefined,
  engine: LocalModelRuntimeEngine,
  lifecycle?: LocalRuntimeLifecycle,
): ModelRuntime<LocalModelCallOptions, RuntimeAssistantContentPart> {
  const resolvedId = modelId ?? DEFAULT_LOCAL_MODEL;
  if (
    typeof resolvedId !== "string" || resolvedId.length === 0 ||
    resolvedId !== resolvedId.trim()
  ) {
    throw new TypeError("Local model id must be a non-empty canonical string");
  }

  return {
    executionMode: "server-local" as const,
    runtimeCapabilities: {
      toolCalling: false,
      structuredOutput: false,
    },
    specificationVersion: "v2" as const,
    provider: "local",
    modelId: `local/${resolvedId}`,

    supportedUrls: {},

    async prepare(abortSignal?: AbortSignal) {
      lifecycle?.assertActive();
      const linkedAbort = linkAbortSignals(abortSignal, lifecycle?.signal);
      try {
        await engine.prepare?.(resolvedId, linkedAbort.signal);
        lifecycle?.assertActive();
      } finally {
        linkedAbort.cleanup();
      }
    },

    async doGenerate(options: LocalModelCallOptions) {
      lifecycle?.assertActive();
      const messages = convertPrompt(options.prompt);
      const requestedOptions = toGenerateOptions(options);
      const linkedAbort = linkAbortSignals(requestedOptions.abortSignal, lifecycle?.signal);
      try {
        throwIfAborted(linkedAbort.signal);
        const genOptions: GenerateOptions = {
          ...requestedOptions,
          abortSignal: linkedAbort.signal,
        };

        logger.debug(`[local] doGenerate: ${messages.length} messages -> ${resolvedId}`);

        const result = validateGenerationResult(
          await waitForAbortableGeneration(
            engine.generate(resolvedId, messages, genOptions),
            linkedAbort.signal,
          ),
        );
        throwIfAborted(linkedAbort.signal);
        lifecycle?.assertActive();

        return {
          content: [{ type: "text" as const, text: result.text }],
          finishReason: result.finishReason,
          warnings: [],
        };
      } finally {
        linkedAbort.cleanup();
      }
    },

    async doStream(options: LocalModelCallOptions) {
      lifecycle?.assertActive();
      const messages = convertPrompt(options.prompt);
      const requestedOptions = toGenerateOptions(options);
      const linkedAbort = linkAbortSignals(requestedOptions.abortSignal, lifecycle?.signal);
      const abortSignal = linkedAbort.signal;
      try {
        throwIfAborted(abortSignal);
        const genOptions: GenerateOptions = { ...requestedOptions, abortSignal };
        await engine.prepare?.(resolvedId, abortSignal);
        throwIfAborted(abortSignal);
        lifecycle?.assertActive();

        logger.debug(`[local] doStream: ${messages.length} messages -> ${resolvedId}`);

        const textId = `text-${crypto.randomUUID()}`;
        const generationAbortController = new AbortController();
        const leadingParts: Array<Record<string, unknown>> = [
          { type: "stream-start", warnings: [] },
          {
            type: "response-metadata",
            id: `local-${crypto.randomUUID()}`,
            timestamp: new Date(),
            modelId: `local/${resolvedId}`,
          },
          { type: "text-start", id: textId },
        ];
        let leadingPartIndex = 0;
        let trailingPartIndex = 0;
        let streamController:
          | ReadableStreamDefaultController<Record<string, unknown>>
          | undefined;
        let streamSettled = false;
        let cleanupCompleted = false;
        let generationIterator:
          | AsyncIterator<string, LocalGenerationFinishReason>
          | undefined;
        let generationIteratorCompleted = false;
        let inFlightGenerationNext:
          | {
            promise: Promise<IteratorResult<string, LocalGenerationFinishReason>>;
            settled: boolean;
            rejected: boolean;
            error?: unknown;
          }
          | undefined;
        let iteratorClosePromise: Promise<readonly unknown[]> | undefined;
        let finishReason: LocalGenerationFinishReason | undefined;
        const addDistinctFailure = (failures: unknown[], failure: unknown) => {
          if (!failures.includes(failure)) failures.push(failure);
        };
        const extractSecondaryFailures = (
          error: unknown,
          hasPrimary: boolean,
          primaryReason: unknown,
        ): unknown[] => {
          if (hasPrimary && error === primaryReason) return [];
          if (
            hasPrimary && error instanceof LocalGenerationCleanupError &&
            error.primaryError === primaryReason
          ) {
            return [...error.cleanupErrors];
          }
          if (hasPrimary && error instanceof AggregateError) {
            const errors = [...error.errors];
            if (errors[0] === primaryReason) return errors.slice(1);
          }
          return [error];
        };
        const formatCleanupFailures = (failures: readonly unknown[]): unknown => {
          if (failures.length === 1) return failures[0];
          return new AggregateError(
            failures,
            "Local generation iterator cleanup failed",
          );
        };
        const closeGenerationIterator = (): Promise<readonly unknown[]> => {
          if (
            !generationIterator ||
            generationIteratorCompleted
          ) {
            return Promise.resolve([]);
          }
          if (iteratorClosePromise) return iteratorClosePromise;

          // Install the singleflight latch before invoking user-controlled
          // return(); a synchronous reentrant abort must reuse this operation.
          const closeDeferred = Promise.withResolvers<readonly unknown[]>();
          iteratorClosePromise = closeDeferred.promise;
          const pendingNext = inFlightGenerationNext;
          const hasPrimary = generationAbortController.signal.aborted;
          const primaryReason = generationAbortController.signal.reason;
          const settleClose = (returnRejected: boolean, returnError?: unknown) => {
            const failures: unknown[] = [];
            if (pendingNext?.settled && pendingNext.rejected) {
              for (
                const failure of extractSecondaryFailures(
                  pendingNext.error,
                  hasPrimary,
                  primaryReason,
                )
              ) {
                addDistinctFailure(failures, failure);
              }
            }
            if (returnRejected) {
              for (
                const failure of extractSecondaryFailures(
                  returnError,
                  hasPrimary,
                  primaryReason,
                )
              ) {
                addDistinctFailure(failures, failure);
              }
            }

            closeDeferred.resolve(failures);

            if (pendingNext && !pendingNext.settled) {
              // A custom iterator may finish return() while an unrelated next()
              // remains pending. Cancellation must stay prompt; report any
              // later non-primary failure because it can no longer be surfaced
              // through the already-settled cancellation promise.
              void pendingNext.promise.then(
                () => {},
                (error) => {
                  const lateFailures = extractSecondaryFailures(
                    error,
                    hasPrimary,
                    primaryReason,
                  );
                  if (lateFailures.length > 0) {
                    reportIteratorCleanupFailure(
                      formatCleanupFailures(lateFailures),
                      primaryReason,
                    );
                  }
                },
              );
            }
          };

          try {
            const closing = generationIterator.return?.();
            void Promise.resolve(closing).then(
              () => settleClose(false),
              (error) => settleClose(true, error),
            );
          } catch (error) {
            settleClose(true, error);
          }
          return iteratorClosePromise;
        };
        let iteratorCleanupFailureReported = false;
        const reportIteratorCleanupFailure = (
          cleanupError: unknown,
          primaryReason: unknown,
        ) => {
          if (iteratorCleanupFailureReported) return;
          iteratorCleanupFailureReported = true;
          logger.warn("Failed to close local generation iterator after stream termination", {
            cleanupError: cleanupError instanceof Error
              ? `${cleanupError.name}: ${cleanupError.message}`
              : String(cleanupError),
            primaryReason: primaryReason instanceof Error
              ? primaryReason.name
              : typeof primaryReason,
          });
        };
        const cleanupStream = () => {
          if (cleanupCompleted) return;
          cleanupCompleted = true;
          abortSignal?.removeEventListener("abort", forwardAbort);
          linkedAbort.cleanup();
        };
        const settleControllerError = (reason: unknown) => {
          if (streamSettled) return;
          streamSettled = true;
          cleanupStream();
          try {
            streamController?.error(reason);
          } catch {
            // Cancellation may have closed the consumer-facing stream first.
          }
        };
        const abortGeneration = (reason: unknown): Promise<readonly unknown[]> => {
          generationAbortController.abort(reason);
          return closeGenerationIterator();
        };
        const errorStream = (reason: unknown) => {
          const closing = abortGeneration(reason);
          void closing.then((cleanupErrors) => {
            if (cleanupErrors.length > 0) {
              reportIteratorCleanupFailure(
                formatCleanupFailures(cleanupErrors),
                reason,
              );
            }
          });
          settleControllerError(reason);
        };
        const splitGenerationFailure = (reason: unknown): {
          primaryReason: unknown;
          cleanupErrors: unknown[];
        } =>
          reason instanceof LocalGenerationCleanupError
            ? {
              primaryReason: reason.primaryError,
              cleanupErrors: [...reason.cleanupErrors],
            }
            : { primaryReason: reason, cleanupErrors: [] };
        const abortAndCombineCleanupError = async (reason: unknown): Promise<{
          primaryReason: unknown;
          surfacedError: Error;
          cleanupErrors: readonly unknown[];
        }> => {
          const splitFailure = splitGenerationFailure(reason);
          const primaryReason = splitFailure.primaryReason;
          const primaryError = primaryReason instanceof Error
            ? primaryReason
            : new Error(String(primaryReason));
          const cleanupErrors = splitFailure.cleanupErrors;
          for (const error of await abortGeneration(primaryReason)) {
            addDistinctFailure(cleanupErrors, error);
          }
          const surfacedError = cleanupErrors.length === 0 ? primaryError : new AggregateError(
            [primaryError, ...cleanupErrors],
            "Local generation and iterator cleanup both failed",
          );
          return { primaryReason, surfacedError, cleanupErrors };
        };
        const forwardAbort = () => {
          const reason = abortReason(abortSignal!);
          errorStream(reason);
        };
        if (abortSignal) {
          abortSignal.addEventListener("abort", forwardAbort, { once: true });
        }

        const stream = new ReadableStream<Record<string, unknown>>({
          start(controller) {
            streamController = controller;
          },

          async pull(controller) {
            if (streamSettled) return;
            try {
              throwIfAborted(generationAbortController.signal);
              lifecycle?.assertActive();

              if (leadingPartIndex < leadingParts.length) {
                controller.enqueue(leadingParts[leadingPartIndex++]);
                return;
              }

              if (!generationIteratorCompleted) {
                if (!generationIterator) {
                  // Acquire the iterator only when downstream has consumed the
                  // bounded protocol prelude and requests generated output.
                  generationIterator = engine.generateStream(resolvedId, messages, {
                    ...genOptions,
                    abortSignal: generationAbortController.signal,
                  })[Symbol.asyncIterator]();
                }
                // A custom iterable can synchronously abort the caller while its
                // iterator is being acquired. Check after retaining it so its
                // return hook is still invoked during cleanup.
                if (generationAbortController.signal.aborted) {
                  const reason = abortReason(generationAbortController.signal);
                  const cleanupErrors = await closeGenerationIterator();
                  if (cleanupErrors.length > 0) {
                    reportIteratorCleanupFailure(
                      formatCleanupFailures(cleanupErrors),
                      reason,
                    );
                  }
                }
                throwIfAborted(generationAbortController.signal);
                const nextPromise = Promise.resolve(generationIterator.next());
                const pendingNext = {
                  promise: nextPromise,
                  settled: false,
                  rejected: false,
                  error: undefined as unknown,
                };
                inFlightGenerationNext = pendingNext;
                void nextPromise.then(
                  () => {
                    pendingNext.settled = true;
                  },
                  (error) => {
                    pendingNext.settled = true;
                    pendingNext.rejected = true;
                    pendingNext.error = error;
                  },
                );
                let next: IteratorResult<string, LocalGenerationFinishReason>;
                try {
                  next = await nextPromise;
                } finally {
                  if (inFlightGenerationNext === pendingNext) {
                    inFlightGenerationNext = undefined;
                  }
                }
                throwIfAborted(generationAbortController.signal);
                lifecycle?.assertActive();
                if (!next.done) {
                  if (typeof next.value !== "string") {
                    throw new TypeError("Local generation stream yielded a non-string chunk");
                  }
                  controller.enqueue({
                    type: "text-delta",
                    id: textId,
                    delta: next.value,
                  });
                  return;
                }

                generationIteratorCompleted = true;
                if (next.value !== "stop" && next.value !== "length") {
                  throw new TypeError(
                    "Local generation stream completed without a valid finish reason",
                  );
                }
                finishReason = next.value;
              }

              if (trailingPartIndex === 0) {
                trailingPartIndex += 1;
                controller.enqueue({ type: "text-end", id: textId });
                return;
              }

              if (trailingPartIndex === 1) {
                trailingPartIndex += 1;
                controller.enqueue({
                  type: "finish",
                  finishReason,
                });
                streamSettled = true;
                cleanupStream();
                controller.close();
                return;
              }
            } catch (error) {
              if (streamSettled) return;
              if (generationAbortController.signal.aborted) {
                errorStream(abortReason(generationAbortController.signal));
                return;
              }

              // Let no_ai_available propagate. The chat handler needs it for a
              // proper 503 response instead of a 200 with an in-band error.
              const failure = await abortAndCombineCleanupError(error);
              const vfError = fromError(failure.primaryReason);
              if (streamSettled) {
                if (failure.cleanupErrors.length > 0) {
                  reportIteratorCleanupFailure(
                    formatCleanupFailures(failure.cleanupErrors),
                    failure.primaryReason,
                  );
                }
                return;
              }
              if (vfError?.type === "no_ai_available") {
                if (failure.cleanupErrors.length > 0) {
                  reportIteratorCleanupFailure(
                    formatCleanupFailures(failure.cleanupErrors),
                    failure.primaryReason,
                  );
                }
                settleControllerError(failure.primaryReason);
                return;
              }

              controller.enqueue({
                type: "error",
                error: failure.surfacedError,
              });
              streamSettled = true;
              cleanupStream();
              controller.close();
            }
          },

          async cancel(reason) {
            const cancellationReason = reason ??
              new DOMException("The local stream was canceled.", "AbortError");
            streamSettled = true;
            cleanupStream();
            const cleanupErrors = await abortGeneration(cancellationReason);
            if (cleanupErrors.length === 1) throw cleanupErrors[0];
            if (cleanupErrors.length > 1) {
              throw new AggregateError(
                cleanupErrors,
                "Local generation iterator cleanup failed",
              );
            }
          },
        }, { highWaterMark: 1 });

        return { stream };
      } catch (error) {
        linkedAbort.cleanup();
        throw error;
      }
    },
  };
}

export function createLocalModel(
  modelId?: string,
  lifecycle?: LocalRuntimeLifecycle,
): ModelRuntime<LocalModelCallOptions, RuntimeAssistantContentPart> {
  const resolvedId = modelId ?? DEFAULT_LOCAL_MODEL;
  resolveLocalModel(resolvedId);
  return createLocalModelRuntime(resolvedId, defaultLocalModelRuntimeEngine, lifecycle);
}
