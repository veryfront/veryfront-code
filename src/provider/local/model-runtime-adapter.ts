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
    // Skip tool messages. Local models do not support tool calling.
    if (msg.role === "tool") continue;

    const mappedRole = msg.role === "system"
      ? "system"
      : msg.role === "user"
      ? "user"
      : "assistant";

    // Extract text content from content array
    let text = "";
    if (typeof msg.content === "string") {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === "text" && typeof part.text === "string") {
          text += part.text;
        }
      }
    }

    if (text) {
      messages.push({ role: mappedRole, content: text });
    }
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
}

/** Map model-runtime generation options to local engine GenerateOptions. */
function toGenerateOptions(options: LocalModelOptions): GenerateOptions {
  return {
    maxNewTokens: options.maxOutputTokens ?? DEFAULT_MAX_NEW_TOKENS,
    temperature: options.temperature ?? 0.7,
    topP: options.topP,
    topK: options.topK,
    stopSequences: options.stopSequences,
  };
}

/**
 * Create a local model runtime for the given model ID.
 *
 * The returned object implements the current runtime interface, making it
 * compatible with the framework execution path and related hooks.
 */
export function createLocalModel(modelId?: string): ModelRuntime {
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
      const messages = convertPrompt(options.prompt);
      const genOptions = toGenerateOptions(options);

      logger.debug(`[local] doGenerate: ${messages.length} messages -> ${resolvedId}`);

      const text = await generate(resolvedId, messages, genOptions);

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

      const messages = convertPrompt(options.prompt);
      const genOptions = toGenerateOptions(options);

      logger.debug(`[local] doStream: ${messages.length} messages -> ${resolvedId}`);

      const textId = `text-${Date.now()}`;

      const stream = new ReadableStream({
        async start(controller) {
          try {
            // Emit stream-start
            controller.enqueue({ type: "stream-start", warnings: [] });

            // Emit response metadata
            controller.enqueue({
              type: "response-metadata",
              id: `local-${Date.now()}`,
              timestamp: new Date(),
              modelId: `local/${resolvedId}`,
            });

            // Emit text-start
            controller.enqueue({ type: "text-start", id: textId });

            // Stream tokens
            for await (const token of generateStream(resolvedId, messages, genOptions)) {
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
            // Let no_ai_available propagate. The chat handler needs it
            // for a proper 503 response instead of a 200 with in-band error.
            const vfError = fromError(error);
            if (vfError?.type === "no_ai_available") throw error;

            controller.enqueue({
              type: "error",
              error: error instanceof Error ? error : new Error(String(error)),
            });
            controller.close();
          }
        },
      });

      return { stream };
    },
  };
}
