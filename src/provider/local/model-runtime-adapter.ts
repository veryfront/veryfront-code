/**
 * Local Model Runtime Adapter
 *
 * Bridges `@huggingface/transformers` local inference to the framework's
 * current model runtime substrate. This allows `streamText()` and
 * `generateText()` to work with local models seamlessly.
 *
 * @module provider/local
 */

import { generate, generateStream } from "./local-engine.ts";
import type { ChatMessage, GenerateOptions } from "./local-engine.ts";
import { DEFAULT_LOCAL_MODEL } from "./model-catalog.ts";
import { serverLogger } from "#veryfront/utils";
import { fromError } from "#veryfront/errors";
import { throwIfLocalAIDisabled } from "./env.ts";
import type { ModelRuntime } from "../types.ts";

const logger = serverLogger.component("local-llm");

/** Default maximum new tokens for local model generation */
const DEFAULT_MAX_NEW_TOKENS = 512;

/** Shape of a single message in the current model-runtime prompt array. */
interface PromptMessage {
  role: string;
  content: string | ReadonlyArray<{ type: string; text?: string }>;
}

/**
 * Convert model-runtime prompt format to simple ChatMessage array.
 *
 * The prompt is an array of message objects with role and content arrays.
 * We extract text content for the local model.
 */
function convertPrompt(prompt: ReadonlyArray<PromptMessage>): ChatMessage[] {
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
        if (part.type !== "text" || typeof part.text !== "string") {
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

interface LocalModelOptions {
  prompt: ReadonlyArray<PromptMessage>;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  abortSignal?: AbortSignal;
}

export interface LocalModelRuntimeEngine {
  generate(
    modelId: string,
    messages: ChatMessage[],
    options: GenerateOptions,
  ): Promise<string>;
  generateStream(
    modelId: string,
    messages: ChatMessage[],
    options: GenerateOptions,
  ): AsyncIterable<string>;
}

const defaultLocalModelRuntimeEngine: LocalModelRuntimeEngine = {
  generate,
  generateStream,
};

/** Map model-runtime generation options to local engine GenerateOptions. */
function toGenerateOptions(options: LocalModelOptions): GenerateOptions {
  return {
    maxNewTokens: options.maxOutputTokens ?? DEFAULT_MAX_NEW_TOKENS,
    temperature: options.temperature ?? 0.7,
    topP: options.topP,
    topK: options.topK,
    stopSequences: options.stopSequences,
    abortSignal: options.abortSignal,
  };
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

/**
 * Create a local model runtime for the given model ID.
 *
 * The returned object implements the current runtime interface, making it
 * compatible with the framework execution path and related hooks.
 */
export function createLocalModelRuntime(
  modelId: string | undefined,
  engine: LocalModelRuntimeEngine,
): ModelRuntime {
  const resolvedId = modelId || DEFAULT_LOCAL_MODEL;

  return {
    /** Marker so ensureModelReady() can distinguish real local-engine models
     *  from mock/custom providers that happen to use provider:"local". */
    _isVfLocalModel: true as const,
    specificationVersion: "v2" as const,
    provider: "local",
    modelId: `local/${resolvedId}`,

    supportedUrls: {},

    async doGenerate(options: LocalModelOptions) {
      throwIfAborted(options.abortSignal);
      const messages = convertPrompt(options.prompt);
      const genOptions = toGenerateOptions(options);

      logger.debug(`[local] doGenerate: ${messages.length} messages -> ${resolvedId}`);

      const text = await waitForAbortableGeneration(
        engine.generate(resolvedId, messages, genOptions),
        options.abortSignal,
      );
      throwIfAborted(options.abortSignal);

      return {
        content: [{ type: "text" as const, text }],
        finishReason: "stop" as const,
        warnings: [],
      };
    },

    async doStream(options: LocalModelOptions) {
      // Eagerly check if local AI is disabled. This must throw before creating the
      // ReadableStream, otherwise the 200 response headers are already committed.
      // Note: getTransformers() in local-engine.ts also checks this, but we need
      // the check here too because doStream creates a ReadableStream wrapper and
      // errors inside it would be swallowed as in-band stream errors.
      throwIfLocalAIDisabled();
      throwIfAborted(options.abortSignal);

      const messages = convertPrompt(options.prompt);
      const genOptions = toGenerateOptions(options);

      logger.debug(`[local] doStream: ${messages.length} messages -> ${resolvedId}`);

      const textId = `text-${crypto.randomUUID()}`;
      const generationAbortController = new AbortController();
      let streamController:
        | ReadableStreamDefaultController<Record<string, unknown>>
        | undefined;
      let streamSettled = false;
      const errorStream = (reason: unknown) => {
        if (streamSettled) return;
        streamSettled = true;
        try {
          streamController?.error(reason);
        } catch {
          // Cancellation may have closed the consumer-facing stream first.
        }
      };
      let inFlight: Promise<void> | undefined;
      let generationIterator: AsyncIterator<string> | undefined;
      let generationIteratorCompleted = false;
      let iteratorCloseStarted = false;
      const closeGenerationIterator = () => {
        if (
          !generationIterator ||
          iteratorCloseStarted ||
          generationIteratorCompleted
        ) {
          return;
        }
        iteratorCloseStarted = true;
        try {
          const closing = generationIterator.return?.();
          void closing?.catch(() => {
            // The consumer has already been released; cleanup is best effort.
          });
        } catch {
          // A custom iterator may throw synchronously while being closed.
        }
      };
      const abortGeneration = (reason: unknown) => {
        generationAbortController.abort(reason);
        closeGenerationIterator();
      };
      const forwardAbort = () => {
        const reason = abortReason(options.abortSignal!);
        abortGeneration(reason);
        errorStream(reason);
      };
      if (options.abortSignal) {
        options.abortSignal.addEventListener("abort", forwardAbort, { once: true });
      }

      const stream = new ReadableStream<Record<string, unknown>>({
        start(controller) {
          streamController = controller;
          inFlight = (async () => {
            try {
              throwIfAborted(generationAbortController.signal);

              // Emit stream-start
              controller.enqueue({ type: "stream-start", warnings: [] });

              // Emit response metadata
              controller.enqueue({
                type: "response-metadata",
                id: `local-${crypto.randomUUID()}`,
                timestamp: new Date(),
                modelId: `local/${resolvedId}`,
              });

              // Emit text-start
              controller.enqueue({ type: "text-start", id: textId });

              // Stream tokens
              generationIterator = engine.generateStream(resolvedId, messages, {
                ...genOptions,
                abortSignal: generationAbortController.signal,
              })[Symbol.asyncIterator]();
              // A custom iterable can synchronously abort the caller while its
              // iterator is being acquired. Check again after retaining the
              // iterator so its return hook is still invoked during cleanup.
              throwIfAborted(generationAbortController.signal);
              while (true) {
                const next = await generationIterator.next();
                if (next.done) {
                  generationIteratorCompleted = true;
                  break;
                }
                throwIfAborted(generationAbortController.signal);
                controller.enqueue({
                  type: "text-delta",
                  id: textId,
                  delta: next.value,
                });
              }
              throwIfAborted(generationAbortController.signal);

              // Emit text-end
              controller.enqueue({ type: "text-end", id: textId });

              // Emit finish
              controller.enqueue({
                type: "finish",
                finishReason: "stop",
              });

              streamSettled = true;
              controller.close();
            } catch (error) {
              if (streamSettled) {
                return;
              }
              if (generationAbortController.signal.aborted) {
                errorStream(abortReason(generationAbortController.signal));
                return;
              }

              // Let no_ai_available propagate. The chat handler needs it
              // for a proper 503 response instead of a 200 with in-band error.
              const vfError = fromError(error);
              if (vfError?.type === "no_ai_available") {
                errorStream(error);
                return;
              }

              controller.enqueue({
                type: "error",
                error: error instanceof Error ? error : new Error(String(error)),
              });
              streamSettled = true;
              controller.close();
            } finally {
              closeGenerationIterator();
              options.abortSignal?.removeEventListener("abort", forwardAbort);
            }
          })();
          void inFlight.catch((error) => errorStream(error));
        },

        cancel(reason) {
          streamSettled = true;
          options.abortSignal?.removeEventListener("abort", forwardAbort);
          abortGeneration(
            reason ?? new DOMException("The local stream was canceled.", "AbortError"),
          );
          void inFlight?.catch(() => {});
        },
      });

      return { stream };
    },
  };
}

export function createLocalModel(modelId?: string): ModelRuntime {
  return createLocalModelRuntime(modelId, defaultLocalModelRuntimeEngine);
}
