/**
 * AI SDK Stream Handler
 *
 * Processes AI SDK `streamText()` fullStream parts and emits SSE events
 * in the Data Stream Protocol format. AI SDK stream parts map 1:1
 * to our SSE protocol with minimal field remapping.
 *
 * @module ai/agent/runtime/ai-stream-handler
 */

import type { StreamTextResult, ToolSet } from "ai";
import { sendSSE } from "./sse-utils.ts";
import { isDynamicTool } from "./tool-helpers.ts";
import { serverLogger } from "#veryfront/utils";
import { setActiveSpanAttributes, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const logger = serverLogger.component("agent");

export interface StreamingToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface AIStreamState {
  accumulatedText: string;
  finishReason: string | null;
  toolCalls: Map<string, StreamingToolCall>;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface AIStreamCallbacks {
  onChunk?: (chunk: string) => void;
  onUsage?: (usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  }) => void;
}

export function createStreamState(): AIStreamState {
  return {
    accumulatedText: "",
    finishReason: null,
    toolCalls: new Map(),
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
}

/**
 * Process the AI SDK fullStream and emit SSE events.
 *
 * AI SDK stream parts map directly to our Data Stream Protocol SSE events:
 * - text-delta → text-delta SSE (with id and delta)
 * - tool-input-start → tool-input-start SSE
 * - tool-input-delta → tool-input-delta SSE
 * - tool-call → tool-input-available SSE (accumulated input)
 * - finish → captures finishReason and usage
 */
export function processStream(
  result: StreamTextResult<ToolSet, never>,
  state: AIStreamState,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  textPartId: string | undefined,
  callbacks?: AIStreamCallbacks,
): Promise<void> {
  return withSpan("agent.runtime.processStream", async () => {
    let eventCount = 0;

    for await (const part of result.fullStream) {
      eventCount++;

      switch (part.type) {
        case "text-delta": {
          state.accumulatedText += part.text;
          sendSSE(controller, encoder, {
            type: "text-delta",
            id: textPartId,
            delta: part.text,
          });
          callbacks?.onChunk?.(part.text);
          break;
        }

        case "tool-input-start": {
          const toolId = part.id;
          state.toolCalls.set(toolId, {
            id: toolId,
            name: part.toolName,
            arguments: "",
          });

          const dynamic = isDynamicTool(part.toolName);
          sendSSE(controller, encoder, {
            type: "tool-input-start",
            toolCallId: toolId,
            toolName: part.toolName,
            ...(dynamic ? { dynamic: true } : {}),
          });
          break;
        }

        case "tool-input-delta": {
          const toolId = part.id;
          const tc = state.toolCalls.get(toolId);
          if (!tc) break;

          tc.arguments += part.delta;
          sendSSE(controller, encoder, {
            type: "tool-input-delta",
            toolCallId: toolId,
            inputTextDelta: part.delta,
          });
          break;
        }

        case "tool-call": {
          // tool-call fires when the full tool call is available
          const toolId = part.toolCallId;
          const inputStr = JSON.stringify(part.input);
          state.toolCalls.set(toolId, {
            id: toolId,
            name: part.toolName,
            arguments: inputStr,
          });

          const dynamic = isDynamicTool(part.toolName);
          // part.input is already a parsed object — pass directly to avoid double serialization
          const inputObj =
            (part.input && typeof part.input === "object" && !Array.isArray(part.input))
              ? part.input as Record<string, unknown>
              : {};
          sendSSE(controller, encoder, {
            type: "tool-input-available",
            toolCallId: toolId,
            toolName: part.toolName,
            input: inputObj,
            ...(dynamic ? { dynamic: true } : {}),
          });
          break;
        }

        case "finish": {
          state.finishReason = part.finishReason;
          if (part.totalUsage) {
            const input = part.totalUsage.inputTokens ?? 0;
            const output = part.totalUsage.outputTokens ?? 0;
            state.usage = {
              promptTokens: input,
              completionTokens: output,
              totalTokens: input + output,
            };
            callbacks?.onUsage?.(state.usage);
          }
          break;
        }

        case "error": {
          logger.warn("AI SDK stream error:", part.error);
          sendSSE(controller, encoder, {
            type: "error",
            error: part.error instanceof Error ? part.error.message : String(part.error),
          });
          break;
        }

        default:
          // Ignore other stream parts (source, file, reasoning-*, etc.)
          break;
      }
    }

    setActiveSpanAttributes({
      "stream.event_count": eventCount,
      "stream.tool_calls": state.toolCalls.size,
      "stream.text_length": state.accumulatedText.length,
    });
  });
}
