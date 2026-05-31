/**
 * Model Runtime Stream Handler
 *
 * Processes model-runtime `streamText()` fullStream parts and emits SSE
 * events in the Data Stream Protocol format. Stream parts map 1:1 to the
 * framework SSE protocol with minimal field remapping.
 *
 * @module agent/runtime/chat-stream-handler
 */

import type { RuntimeStreamPart, RuntimeStreamResult } from "./runtime-tool-types.ts";
import { sendSSE } from "./sse-utils.ts";
import {
  mergeToolCallInput,
  mergeToolInputDelta,
  parseToolInputObject,
} from "../streaming/data-stream.ts";
import { isDynamicTool } from "./tool-helpers.ts";
import { serverLogger } from "#veryfront/utils";
import { isAnyDebugEnabled } from "#veryfront/utils/constants/env.ts";
import { setActiveSpanAttributes, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { stringifyToolError, throwIfAborted } from "./error-utils.ts";

const logger = serverLogger.component("agent");
const LOCAL_TOOL_COMMIT_GRACE_MS = 250;

export interface StreamingToolCall {
  id: string;
  name: string;
  arguments: string;
  inputAvailable?: boolean;
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

export interface ChatStreamState {
  accumulatedText: string;
  finishReason: string | null;
  toolCalls: Map<string, StreamingToolCall>;
  toolResults: StreamingToolResult[];
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface ChatStreamCallbacks {
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

function summarizeDebugValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }

  return value;
}

function logProviderToolPart(
  partType: "tool-result" | "tool-error",
  part: {
    toolCallId: string;
    toolName: string;
    providerExecuted?: boolean;
    dynamic?: boolean;
    output?: unknown;
    error?: unknown;
    input?: unknown;
    preliminary?: boolean;
    isError?: boolean;
  },
): void {
  if (!isAnyDebugEnabled({ get: getHostEnv })) {
    return;
  }

  if (part.providerExecuted !== true) {
    return;
  }

  if (part.toolName !== "web_search" && part.toolName !== "web_fetch") {
    return;
  }

  logger.debug("Provider tool stream part observed", {
    partType,
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    providerExecuted: part.providerExecuted,
    dynamic: part.dynamic,
    preliminary: part.preliminary,
    isError: part.isError,
    outputType: typeof part.output,
    errorType: typeof part.error,
    inputType: typeof part.input,
    output: summarizeDebugValue(part.output),
    error: summarizeDebugValue(part.error),
    input: summarizeDebugValue(part.input),
  });
}

function getStreamErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  if (
    typeof error === "object" && error !== null && "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return String(error);
}

function isLateProviderBodyReadError(error: unknown): boolean {
  return /error reading a body from connection/i.test(getStreamErrorMessage(error));
}

function hasCompletedStepSignal(finishReason: string | null): boolean {
  switch (finishReason) {
    case "stop":
    case "length":
    case "tool-calls":
    case "content-filter":
    case "other":
      return true;
    default:
      return false;
  }
}

function hasStreamOutput(state: ChatStreamState): boolean {
  return state.accumulatedText.length > 0 || state.toolCalls.size > 0 ||
    state.toolResults.length > 0;
}

function shouldIgnoreLateProviderBodyReadError(state: ChatStreamState, error: unknown): boolean {
  return hasStreamOutput(state) && hasCompletedStepSignal(state.finishReason) &&
    isLateProviderBodyReadError(error);
}

async function readNextStreamPart(
  iterator: AsyncIterator<unknown>,
  state: ChatStreamState,
): Promise<IteratorResult<unknown>> {
  try {
    return await iterator.next();
  } catch (error) {
    if (!shouldIgnoreLateProviderBodyReadError(state, error)) {
      throw error;
    }

    logger.warn("Ignoring late provider body read error after completed stream step", {
      finishReason: state.finishReason,
      toolCallCount: state.toolCalls.size,
      toolResultCount: state.toolResults.length,
      textLength: state.accumulatedText.length,
      error: getStreamErrorMessage(error),
    });

    return { done: true, value: undefined };
  }
}

async function readNextStreamPartWithTimeout(
  iterator: AsyncIterator<unknown>,
  state: ChatStreamState,
  timeoutMs: number,
): Promise<IteratorResult<unknown> | "timeout"> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readNextStreamPart(iterator, state),
      new Promise<"timeout">((resolve) => {
        timeoutId = setTimeout(() => resolve("timeout"), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export function createStreamState(): ChatStreamState {
  return {
    accumulatedText: "",
    finishReason: null,
    toolCalls: new Map(),
    toolResults: [],
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
}

/**
 * Process the model-runtime fullStream and emit SSE events.
 *
 * Stream parts map directly to our Data Stream Protocol SSE events:
 * - text-delta → text-delta SSE (with id and delta)
 * - tool-input-start → tool-input-start SSE
 * - tool-input-delta → tool-input-delta SSE
 * - tool-call → tool-input-available SSE (accumulated input)
 * - finish → captures finishReason and usage
 */
export function processStream(
  result: RuntimeStreamResult,
  state: ChatStreamState,
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  textPartId: string | undefined,
  callbacks?: ChatStreamCallbacks,
  abortSignal?: AbortSignal,
): Promise<void> {
  return withSpan("agent.runtime.processStream", async () => {
    let eventCount = 0;
    let textOpen = false;
    let activeReasoningId: string | null = null;
    let shouldStopForCommittedLocalToolCall = false;

    const normalizeReasoningId = (part: { id?: string }) =>
      typeof part.id === "string" && part.id.length > 0 ? part.id : "reasoning";

    const openTextSegment = () => {
      if (textOpen) {
        return;
      }

      textOpen = true;
      sendSSE(controller, encoder, {
        type: "text-start",
        id: textPartId,
      });
    };

    const closeTextSegment = () => {
      if (!textOpen) {
        return;
      }

      textOpen = false;
      sendSSE(controller, encoder, {
        type: "text-end",
        id: textPartId,
      });
    };

    const openReasoningSegment = (reasoningId: string) => {
      if (activeReasoningId === reasoningId) {
        return;
      }

      if (activeReasoningId !== null) {
        sendSSE(controller, encoder, {
          type: "reasoning-end",
          id: activeReasoningId,
        });
      }

      activeReasoningId = reasoningId;
      sendSSE(controller, encoder, {
        type: "reasoning-start",
        id: reasoningId,
      });
    };

    const closeReasoningSegment = () => {
      if (activeReasoningId === null) {
        return;
      }

      sendSSE(controller, encoder, {
        type: "reasoning-end",
        id: activeReasoningId,
      });
      activeReasoningId = null;
    };

    const ensureToolLifecycle = (part: {
      toolCallId: string;
      toolName: string;
      input?: unknown;
      providerExecuted?: boolean;
      dynamic?: boolean;
    }) => {
      const dynamic = part.dynamic ?? isDynamicTool(part.toolName);
      const existing = state.toolCalls.get(part.toolCallId);

      if (!existing) {
        const normalizedInput = parseToolInputObject(part.input);
        state.toolCalls.set(part.toolCallId, {
          id: part.toolCallId,
          name: part.toolName,
          arguments: normalizeToolInputString(part.input),
          inputAvailable: true,
          ...(part.providerExecuted !== undefined
            ? { providerExecuted: part.providerExecuted }
            : {}),
          ...(dynamic ? { dynamic: true } : {}),
        });
        sendSSE(controller, encoder, {
          type: "tool-input-start",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          ...(dynamic ? { dynamic: true } : {}),
        });
        sendSSE(controller, encoder, {
          type: "tool-input-available",
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: normalizedInput,
          ...(part.providerExecuted !== undefined
            ? { providerExecuted: part.providerExecuted }
            : {}),
          ...(dynamic ? { dynamic: true } : {}),
        });
        return;
      }

      if (existing.inputAvailable) {
        return;
      }

      const resolvedArguments = part.input !== undefined
        ? mergeToolCallInput(existing.arguments, normalizeToolInputString(part.input))
        : existing.arguments;
      const resolvedInput = parseToolInputObject(resolvedArguments);
      existing.arguments = resolvedArguments;
      existing.inputAvailable = true;
      if (part.providerExecuted !== undefined) {
        existing.providerExecuted = part.providerExecuted;
      }
      if (dynamic) {
        existing.dynamic = true;
      }

      sendSSE(controller, encoder, {
        type: "tool-input-available",
        toolCallId: part.toolCallId,
        toolName: existing.name,
        input: resolvedInput,
        ...(existing.providerExecuted !== undefined
          ? { providerExecuted: existing.providerExecuted }
          : {}),
        ...(existing.dynamic ? { dynamic: true } : {}),
      });
    };

    throwIfAborted(abortSignal);

    const streamIterator = result.fullStream[Symbol.asyncIterator]();
    while (true) {
      const next = shouldStopForCommittedLocalToolCall
        ? await readNextStreamPartWithTimeout(
          streamIterator,
          state,
          LOCAL_TOOL_COMMIT_GRACE_MS,
        )
        : await readNextStreamPart(streamIterator, state);
      if (next === "timeout") {
        state.finishReason ??= "tool-calls";
        await streamIterator.return?.();
        break;
      }
      if (next.done) {
        break;
      }

      const part = next.value;
      throwIfAborted(abortSignal);
      eventCount++;

      if (!isRecord(part) || typeof part.type !== "string") {
        continue;
      }

      const typedPart = part as RuntimeStreamPart;

      if (typedPart.type.startsWith("data-")) {
        sendSSE(controller, encoder, {
          type: typedPart.type,
          data: "data" in typedPart ? typedPart.data : undefined,
        });
        continue;
      }

      switch (typedPart.type) {
        case "text-delta": {
          closeReasoningSegment();
          openTextSegment();
          state.accumulatedText += typedPart.text;
          sendSSE(controller, encoder, {
            type: "text-delta",
            id: textPartId,
            delta: typedPart.text,
          });
          callbacks?.onChunk?.(typedPart.text);
          break;
        }

        case "reasoning-start": {
          closeTextSegment();
          openReasoningSegment(normalizeReasoningId(typedPart));
          break;
        }

        case "reasoning-delta": {
          closeTextSegment();
          openReasoningSegment(normalizeReasoningId(typedPart));
          sendSSE(controller, encoder, {
            type: "reasoning-delta",
            id: normalizeReasoningId(typedPart),
            delta: typeof typedPart.delta === "string" ? typedPart.delta : "",
          });
          break;
        }

        case "reasoning-end": {
          closeTextSegment();
          if (activeReasoningId === null) {
            activeReasoningId = normalizeReasoningId(typedPart);
          }
          closeReasoningSegment();
          break;
        }

        case "tool-input-start": {
          closeTextSegment();
          closeReasoningSegment();
          const toolId = typedPart.id;
          state.toolCalls.set(toolId, {
            id: toolId,
            name: typedPart.toolName,
            arguments: "",
            inputAvailable: false,
            providerExecuted: typedPart.providerExecuted,
            dynamic: typedPart.dynamic,
          });

          const dynamic = isDynamicTool(typedPart.toolName);
          sendSSE(controller, encoder, {
            type: "tool-input-start",
            toolCallId: toolId,
            toolName: typedPart.toolName,
            ...(dynamic ? { dynamic: true } : {}),
          });
          break;
        }

        case "tool-input-delta": {
          closeReasoningSegment();
          const toolId = typedPart.id;
          const tc = state.toolCalls.get(toolId);
          if (!tc) break;

          tc.arguments = mergeToolInputDelta(tc.arguments, typedPart.delta);
          sendSSE(controller, encoder, {
            type: "tool-input-delta",
            toolCallId: toolId,
            inputTextDelta: typedPart.delta,
          });
          break;
        }

        case "tool-call": {
          closeTextSegment();
          closeReasoningSegment();
          // tool-call fires when the full tool call is available
          const toolId = typedPart.toolCallId;
          const inputStr = normalizeToolInputString(typedPart.input);
          const previousArguments = state.toolCalls.get(toolId)?.arguments ?? "";
          const resolvedArguments = mergeToolCallInput(previousArguments, inputStr);
          state.toolCalls.set(toolId, {
            id: toolId,
            name: typedPart.toolName,
            arguments: resolvedArguments,
            inputAvailable: true,
            providerExecuted: typedPart.providerExecuted,
            dynamic: typedPart.dynamic,
          });

          const dynamic = isDynamicTool(typedPart.toolName);
          const inputObj = parseToolInputObject(typedPart.input);
          sendSSE(controller, encoder, {
            type: "tool-input-available",
            toolCallId: toolId,
            toolName: typedPart.toolName,
            input: inputObj,
            ...(typedPart.providerExecuted !== undefined
              ? { providerExecuted: typedPart.providerExecuted }
              : {}),
            ...(dynamic ? { dynamic: true } : {}),
          });
          if (typedPart.providerExecuted !== true) {
            shouldStopForCommittedLocalToolCall = true;
          }
          break;
        }

        case "tool-result": {
          closeTextSegment();
          closeReasoningSegment();
          ensureToolLifecycle({
            toolCallId: typedPart.toolCallId,
            toolName: typedPart.toolName,
            input: typedPart.input,
            providerExecuted: typedPart.providerExecuted,
            dynamic: typedPart.dynamic,
          });
          const isError = typedPart.isError === true;
          logProviderToolPart("tool-result", {
            toolCallId: typedPart.toolCallId,
            toolName: typedPart.toolName,
            providerExecuted: typedPart.providerExecuted,
            dynamic: typedPart.dynamic,
            output: typedPart.output,
            input: typedPart.input,
            preliminary: typedPart.preliminary,
            isError,
          });
          if (isError) {
            state.toolResults.push({
              toolCallId: typedPart.toolCallId,
              toolName: typedPart.toolName,
              error: typedPart.output,
              ...(typedPart.providerExecuted !== undefined
                ? { providerExecuted: typedPart.providerExecuted }
                : {}),
              ...(typedPart.dynamic ? { dynamic: true } : {}),
            });
            sendSSE(controller, encoder, {
              type: "tool-output-error",
              toolCallId: typedPart.toolCallId,
              errorText: stringifyToolError(typedPart.output),
              ...(typedPart.providerExecuted !== undefined
                ? { providerExecuted: typedPart.providerExecuted }
                : {}),
              ...(typedPart.dynamic ? { dynamic: true } : {}),
            });
            break;
          }

          state.toolResults.push({
            toolCallId: typedPart.toolCallId,
            toolName: typedPart.toolName,
            output: typedPart.output,
            ...(typedPart.providerExecuted !== undefined
              ? { providerExecuted: typedPart.providerExecuted }
              : {}),
            ...(typedPart.dynamic ? { dynamic: true } : {}),
            ...(typedPart.preliminary !== undefined ? { preliminary: typedPart.preliminary } : {}),
          });
          sendSSE(controller, encoder, {
            type: "tool-output-available",
            toolCallId: typedPart.toolCallId,
            output: typedPart.output,
            ...(typedPart.providerExecuted !== undefined
              ? { providerExecuted: typedPart.providerExecuted }
              : {}),
            ...(typedPart.dynamic ? { dynamic: true } : {}),
            ...(typedPart.preliminary !== undefined ? { preliminary: typedPart.preliminary } : {}),
          });
          break;
        }

        case "tool-error": {
          closeTextSegment();
          closeReasoningSegment();
          ensureToolLifecycle({
            toolCallId: typedPart.toolCallId,
            toolName: typedPart.toolName,
            input: typedPart.input,
            providerExecuted: typedPart.providerExecuted,
            dynamic: typedPart.dynamic,
          });
          logProviderToolPart("tool-error", {
            toolCallId: typedPart.toolCallId,
            toolName: typedPart.toolName,
            providerExecuted: typedPart.providerExecuted,
            dynamic: typedPart.dynamic,
            error: typedPart.error,
            input: typedPart.input,
          });
          state.toolResults.push({
            toolCallId: typedPart.toolCallId,
            toolName: typedPart.toolName,
            error: typedPart.error,
            ...(typedPart.providerExecuted !== undefined
              ? { providerExecuted: typedPart.providerExecuted }
              : {}),
            ...(typedPart.dynamic ? { dynamic: true } : {}),
          });
          sendSSE(controller, encoder, {
            type: "tool-output-error",
            toolCallId: typedPart.toolCallId,
            errorText: stringifyToolError(typedPart.error),
            ...(typedPart.providerExecuted !== undefined
              ? { providerExecuted: typedPart.providerExecuted }
              : {}),
            ...(typedPart.dynamic ? { dynamic: true } : {}),
          });
          break;
        }

        case "finish": {
          closeTextSegment();
          closeReasoningSegment();
          state.finishReason = typedPart.finishReason ?? null;
          if (typedPart.totalUsage) {
            const input = typedPart.totalUsage.inputTokens ?? 0;
            const output = typedPart.totalUsage.outputTokens ?? 0;
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
          closeTextSegment();
          closeReasoningSegment();
          logger.warn("Runtime stream error:", typedPart.error);
          sendSSE(controller, encoder, {
            type: "error",
            error: typedPart.error instanceof Error
              ? typedPart.error.message
              : String(typedPart.error),
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
