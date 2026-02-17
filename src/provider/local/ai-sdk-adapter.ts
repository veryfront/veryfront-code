/**
 * AI SDK Adapter for Local Models
 *
 * Bridges `@huggingface/transformers` local inference to the AI SDK
 * `LanguageModelV2` interface. This allows `streamText()` and
 * `generateText()` to work with local models seamlessly.
 *
 * @module provider/local
 */

import type { LanguageModel } from "ai";
import { generate, generateStream } from "./local-engine.ts";
import type { ChatMessage, GenerateOptions } from "./local-engine.ts";
import { DEFAULT_LOCAL_MODEL } from "./model-catalog.ts";
import { serverLogger } from "#veryfront/utils";
import { createError, fromError, toError } from "#veryfront/errors/veryfront-error.ts";
import { isLocalAIDisabled } from "./env.ts";

const logger = serverLogger.component("local-llm");

/**
 * Convert AI SDK LanguageModelV2 prompt format to simple ChatMessage array.
 *
 * The AI SDK prompt is an array of message objects with role and content arrays.
 * We extract text content for the local model.
 */
// deno-lint-ignore no-explicit-any
function convertPrompt(prompt: any[]): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (const msg of prompt) {
    const role = msg.role as "system" | "user" | "assistant" | "tool";
    // Skip tool messages — local models don't support tool calling
    if (role === "tool") continue;

    const mappedRole = role === "system" ? "system" : role === "user" ? "user" : "assistant";

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

/**
 * Create a local AI SDK LanguageModel for the given model ID.
 *
 * The returned object implements the LanguageModelV2 interface, making it
 * compatible with all AI SDK functions (`streamText`, `generateText`, etc.)
 * and all VeryFront hooks (`useChat`).
 */
export function createLocalModel(modelId?: string): LanguageModel {
  const resolvedId = modelId || DEFAULT_LOCAL_MODEL;

  const model = {
    /** Marker so ensureModelReady() can distinguish real local-engine models
     *  from mock/custom providers that happen to use provider:"local". */
    _isVfLocalModel: true as const,
    specificationVersion: "v2" as const,
    provider: "local",
    modelId: `local/${resolvedId}`,

    supportedUrls: {},

    async doGenerate(options: {
      prompt: unknown[];
      maxOutputTokens?: number;
      temperature?: number;
      topP?: number;
      topK?: number;
      stopSequences?: string[];
    }) {
      const messages = convertPrompt(options.prompt as unknown[]);
      const genOptions: GenerateOptions = {
        maxNewTokens: options.maxOutputTokens ?? 512,
        temperature: options.temperature ?? 0.7,
        topP: options.topP,
        topK: options.topK,
        stopSequences: options.stopSequences,
      };

      logger.debug(`[local] doGenerate: ${messages.length} messages → ${resolvedId}`);

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

    async doStream(options: {
      prompt: unknown[];
      maxOutputTokens?: number;
      temperature?: number;
      topP?: number;
      topK?: number;
      stopSequences?: string[];
    }) {
      // Eagerly check if local AI is disabled — must throw before creating the
      // ReadableStream, otherwise the 200 response headers are already committed.
      // Note: getTransformers() in local-engine.ts also checks this, but we need
      // the check here too because doStream creates a ReadableStream wrapper and
      // errors inside it would be swallowed as in-band stream errors.
      if (isLocalAIDisabled()) {
        throw toError(
          createError({
            type: "no_ai_available",
            message: "Local AI disabled via VERYFRONT_DISABLE_LOCAL_AI environment variable.",
          }),
        );
      }

      const messages = convertPrompt(options.prompt as unknown[]);
      const genOptions: GenerateOptions = {
        maxNewTokens: options.maxOutputTokens ?? 512,
        temperature: options.temperature ?? 0.7,
        topP: options.topP,
        topK: options.topK,
        stopSequences: options.stopSequences,
      };

      logger.debug(`[local] doStream: ${messages.length} messages → ${resolvedId}`);

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
            // Let no_ai_available propagate — the chat handler needs it
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

  return model as LanguageModel;
}
