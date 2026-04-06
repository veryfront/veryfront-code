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
  providerExecuted?: boolean;
  dynamic?: boolean;
}

export interface StreamingToolResult {
  toolCallId: string;
  toolName: string;
  output?: unknown;
  error?: unknown;
  providerExecuted?: boolean;
  dynamic?: boolean;
  preliminary?: boolean;
}

export interface AIStreamState {
  accumulatedText: string;
  finishReason: string | null;
  toolCalls: Map<string, StreamingToolCall>;
  toolResults: StreamingToolResult[];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeToolInputString(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  return JSON.stringify(input ?? null) ?? "null";
}

function normalizeToolInputObject(input: unknown): Record<string, unknown> {
  if (isRecord(input)) {
    return input;
  }

  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      return {};
    }
  }

  return {};
}

function createAbortError(reason?: unknown): Error {
  if (reason instanceof Error) {
    return reason;
  }

  return new DOMException(
    typeof reason === "string" && reason.length > 0 ? reason : "The operation was aborted",
    "AbortError",
  );
}

function throwIfAborted(abortSignal?: AbortSignal): void {
  if (abortSignal?.aborted) {
    throw createAbortError(abortSignal.reason);
  }
}

function stringifyToolError(output: unknown): string {
  if (typeof output === "string" && output.length > 0) {
    return output;
  }

  if (output instanceof Error && typeof output.message === "string" && output.message.length > 0) {
    return output.message;
  }

  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

export function createStreamState(): AIStreamState {
  return {
    accumulatedText: "",
    finishReason: null,
    toolCalls: new Map(),
    toolResults: [],
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
  abortSignal?: AbortSignal,
): Promise<void> {
  return withSpan("agent.runtime.processStream", async () => {
    let eventCount = 0;

    throwIfAborted(abortSignal);

    for await (const part of result.fullStream) {
      throwIfAborted(abortSignal);
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
            providerExecuted: "providerExecuted" in part ? part.providerExecuted : undefined,
            dynamic: "dynamic" in part ? part.dynamic : undefined,
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
          const inputStr = normalizeToolInputString(part.input);
          state.toolCalls.set(toolId, {
            id: toolId,
            name: part.toolName,
            arguments: inputStr,
            providerExecuted: "providerExecuted" in part ? part.providerExecuted : undefined,
            dynamic: "dynamic" in part ? part.dynamic : undefined,
          });

          const dynamic = isDynamicTool(part.toolName);
          const inputObj = normalizeToolInputObject(part.input);
          sendSSE(controller, encoder, {
            type: "tool-input-available",
            toolCallId: toolId,
            toolName: part.toolName,
            input: inputObj,
            ...("providerExecuted" in part && part.providerExecuted !== undefined
              ? { providerExecuted: part.providerExecuted }
              : {}),
            ...(dynamic ? { dynamic: true } : {}),
          });
          break;
        }

        case "tool-result": {
          const isError = "isError" in part && part.isError === true;
          if (isError) {
            state.toolResults.push({
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              error: "output" in part ? part.output : undefined,
              ...("providerExecuted" in part && part.providerExecuted !== undefined
                ? { providerExecuted: part.providerExecuted }
                : {}),
              ...("dynamic" in part && part.dynamic ? { dynamic: true } : {}),
            });
            sendSSE(controller, encoder, {
              type: "tool-output-error",
              toolCallId: part.toolCallId,
              errorText: stringifyToolError("output" in part ? part.output : undefined),
              ...("providerExecuted" in part && part.providerExecuted !== undefined
                ? { providerExecuted: part.providerExecuted }
                : {}),
              ...("dynamic" in part && part.dynamic ? { dynamic: true } : {}),
            });
            break;
          }

          state.toolResults.push({
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            output: part.output,
            ...("providerExecuted" in part && part.providerExecuted !== undefined
              ? { providerExecuted: part.providerExecuted }
              : {}),
            ...("dynamic" in part && part.dynamic ? { dynamic: true } : {}),
            ...("preliminary" in part && part.preliminary !== undefined
              ? { preliminary: part.preliminary }
              : {}),
          });
          sendSSE(controller, encoder, {
            type: "tool-output-available",
            toolCallId: part.toolCallId,
            output: part.output,
            ...("providerExecuted" in part && part.providerExecuted !== undefined
              ? { providerExecuted: part.providerExecuted }
              : {}),
            ...("dynamic" in part && part.dynamic ? { dynamic: true } : {}),
            ...("preliminary" in part && part.preliminary !== undefined
              ? { preliminary: part.preliminary }
              : {}),
          });
          break;
        }

        case "tool-error": {
          state.toolResults.push({
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            error: part.error,
            ...("providerExecuted" in part && part.providerExecuted !== undefined
              ? { providerExecuted: part.providerExecuted }
              : {}),
            ...("dynamic" in part && part.dynamic ? { dynamic: true } : {}),
          });
          sendSSE(controller, encoder, {
            type: "tool-output-error",
            toolCallId: part.toolCallId,
            errorText: stringifyToolError(part.error),
            ...("providerExecuted" in part && part.providerExecuted !== undefined
              ? { providerExecuted: part.providerExecuted }
              : {}),
            ...("dynamic" in part && part.dynamic ? { dynamic: true } : {}),
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

      throwIfAborted(abortSignal);
    }

    throwIfAborted(abortSignal);

    setActiveSpanAttributes({
      "stream.event_count": eventCount,
      "stream.tool_calls": state.toolCalls.size,
      "stream.text_length": state.accumulatedText.length,
    });
  });
}
