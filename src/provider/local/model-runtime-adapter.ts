/**
 * Local Model Runtime Adapter
 *
 * Bridges `@huggingface/transformers` local inference to the framework's
 * current model runtime substrate. This allows `streamText()` and
 * `generateText()` to work with local models seamlessly.
 *
 * @module provider/local
 */

import { assertValidGenerateOptions, generate, generateStream } from "./local-engine.ts";
import type { ChatMessage, GenerateOptions } from "./local-engine.ts";
import { DEFAULT_LOCAL_MODEL, resolveLocalModel } from "./model-catalog.ts";
import { serverLogger } from "#veryfront/utils";
import { fromError } from "#veryfront/errors";
import { throwIfLocalAIDisabled } from "./env.ts";
import type { ModelRuntime } from "../types.ts";

const logger = serverLogger.component("local-llm");

const MAX_LOCAL_PROMPT_CONTENT_PARTS = 4_096;

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
  if (!Array.isArray(prompt) || prompt.length > 1_024) {
    throw new RangeError("Local model prompt must contain at most 1024 messages");
  }
  const messages: ChatMessage[] = [];
  let totalCharacters = 0;
  let totalContentParts = 0;

  for (const msg of prompt) {
    if (!msg || typeof msg !== "object") {
      throw new TypeError("Local model prompt contains an invalid message");
    }
    if (msg.role === "tool") {
      throw new TypeError("Local model does not support tool messages");
    }
    if (msg.role !== "system" && msg.role !== "user" && msg.role !== "assistant") {
      throw new TypeError("Local model prompt contains an unsupported role");
    }

    const mappedRole = msg.role === "system"
      ? "system"
      : msg.role === "user"
      ? "user"
      : "assistant";

    // Extract text content from content array
    let text: string;
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      totalContentParts += msg.content.length;
      if (totalContentParts > MAX_LOCAL_PROMPT_CONTENT_PARTS) {
        throw new RangeError("Local model prompt contains too many content parts");
      }
      const textParts: string[] = [];
      for (const part of msg.content) {
        if (!part || typeof part !== "object" || Array.isArray(part)) {
          throw new TypeError("Local model prompt contains an invalid content part");
        }
        if (part.type === "text" && typeof part.text === "string") {
          textParts.push(part.text);
        } else {
          throw new TypeError("Local models support text prompt content only");
        }
      }
      text = textParts.join("");
    } else {
      throw new TypeError("Local model prompt content must be text or content parts");
    }

    totalCharacters += text.length;
    if (totalCharacters > 4 * 1_024 * 1_024) {
      throw new RangeError("Local model prompt exceeded the supported size");
    }
    messages.push({ role: mappedRole, content: text });
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

/** Map model-runtime generation options to local engine GenerateOptions. */
function toGenerateOptions(options: LocalModelOptions): GenerateOptions {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Local model options must be an object");
  }
  const generationOptions: GenerateOptions = {
    maxNewTokens: options.maxOutputTokens,
    temperature: options.temperature,
    topP: options.topP,
    topK: options.topK,
    stopSequences: options.stopSequences,
    abortSignal: options.abortSignal,
  };
  assertValidGenerateOptions(generationOptions);
  return generationOptions;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Local model request was aborted", "AbortError");
  }
}

function normalizeLocalGenerationError(error: unknown): Error {
  if (error instanceof DOMException && error.name === "AbortError") return error;
  if (fromError(error)) {
    return error instanceof Error ? error : new Error("Local model request failed");
  }
  return new Error("Local model generation failed");
}

/**
 * Create a local model runtime for the given model ID.
 *
 * The returned object implements the current runtime interface, making it
 * compatible with the framework execution path and related hooks.
 */
export function createLocalModel(modelId?: string): ModelRuntime {
  const resolvedId = modelId === undefined ? DEFAULT_LOCAL_MODEL : modelId;
  resolveLocalModel(resolvedId);

  return {
    /** Marker so ensureModelReady() can distinguish real local-engine models
     *  from mock/custom providers that happen to use provider:"local". */
    _isVfLocalModel: true as const,
    specificationVersion: "v2" as const,
    provider: "local",
    modelId: `local/${resolvedId}`,

    supportedUrls: {},

    async doGenerate(options: LocalModelOptions) {
      const genOptions = toGenerateOptions(options);
      throwIfAborted(genOptions.abortSignal);
      const messages = convertPrompt(options.prompt);

      logger.debug(`[local] doGenerate: ${messages.length} messages -> ${resolvedId}`);

      let text: string;
      try {
        text = await generate(resolvedId, messages, genOptions);
      } catch (error) {
        throw normalizeLocalGenerationError(error);
      }

      return {
        content: [{ type: "text" as const, text }],
        finishReason: "stop" as const,
        usage: {
          inputTokens: undefined,
          outputTokens: undefined,
          totalTokens: undefined,
        },
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

      const genOptions = toGenerateOptions(options);
      throwIfAborted(genOptions.abortSignal);
      const messages = convertPrompt(options.prompt);

      logger.debug(`[local] doStream: ${messages.length} messages -> ${resolvedId}`);

      const textId = `text-${crypto.randomUUID()}`;
      const generationController = new AbortController();
      let consumerCanceled = false;
      const abortFromCaller = () => generationController.abort();
      genOptions.abortSignal?.addEventListener("abort", abortFromCaller, { once: true });

      const stream = new ReadableStream({
        async start(controller) {
          try {
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
            for await (
              const token of generateStream(resolvedId, messages, {
                ...genOptions,
                abortSignal: generationController.signal,
              })
            ) {
              controller.enqueue({
                type: "text-delta",
                id: textId,
                delta: token,
              });
            }

            // Emit text-end
            controller.enqueue({ type: "text-end", id: textId });

            // Emit finish
            controller.enqueue({
              type: "finish",
              finishReason: "stop",
              usage: {
                inputTokens: undefined,
                outputTokens: undefined,
                totalTokens: undefined,
              },
            });

            controller.close();
          } catch (error) {
            if (consumerCanceled) return;
            // Let no_ai_available propagate. The chat handler needs it
            // for a proper 503 response instead of a 200 with in-band error.
            const vfError = fromError(error);
            if (vfError?.type === "no_ai_available") throw error;
            if (generationController.signal.aborted) {
              throw new DOMException("Local model request was aborted", "AbortError");
            }

            controller.enqueue({
              type: "error",
              error: normalizeLocalGenerationError(error),
            });
            controller.close();
          } finally {
            genOptions.abortSignal?.removeEventListener("abort", abortFromCaller);
          }
        },
        cancel() {
          consumerCanceled = true;
          generationController.abort();
          genOptions.abortSignal?.removeEventListener("abort", abortFromCaller);
        },
      });

      return { stream };
    },
  };
}
