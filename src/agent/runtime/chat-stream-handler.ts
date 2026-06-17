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
  stripLeadingEmptyObjectPlaceholder,
} from "../streaming/data-stream.ts";
import { isDynamicTool } from "./tool-helpers.ts";
import { serverLogger } from "#veryfront/utils";
import { isAnyDebugEnabled } from "#veryfront/utils/constants/env.ts";
import { setActiveSpanAttributes, withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { stringifyToolError, throwIfAborted } from "./error-utils.ts";
import {
  redactSensitive,
  sanitizeSerializedError,
  sanitizeUrlCredentials,
} from "#veryfront/utils/logger/redact.ts";

const logger = serverLogger.component("agent");
const LOCAL_TOOL_COMMIT_GRACE_MS = 250;
const LOCAL_TOOL_INPUT_IDLE_MS = 15_000;
const STREAM_START_IDLE_MS = 60_000;
const STREAM_OUTPUT_IDLE_MS = 15_000;

export interface StreamingToolCall {
  id: string;
  name: string;
  arguments: string;
  inputDeltas?: string[];
  inputAnnounced?: boolean;
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

export interface StreamingReasoningPart {
  id: string;
  text: string;
  signature?: string;
  redactedData?: string;
}

export interface ChatStreamState {
  accumulatedText: string;
  reasoningParts: StreamingReasoningPart[];
  finishReason: string | null;
  toolCalls: Map<string, StreamingToolCall>;
  toolResults: StreamingToolResult[];
  suppressedToolCalls: { id: string; name: string }[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedInputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    reasoningTokens?: number;
  };
}

export interface ChatStreamCallbacks {
  onChunk?: (chunk: string) => void;
  onUsage?: (usage: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    cachedInputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    reasoningTokens?: number;
  }) => void;
  providerExecutedToolNames?: readonly string[];
  availableToolNames?: readonly string[];
  localToolInputIdleTimeoutMs?: number;
  streamIdleTimeoutMs?: number;
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

function tryParseToolInputObject(input: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(stripLeadingEmptyObjectPlaceholder(input));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function summarizeProviderToolDebugValue(value: unknown): unknown {
  if (value instanceof Error) {
    return sanitizeSerializedError({
      name: value.name,
      message: value.message,
      stack: value.stack,
    });
  }

  if (typeof value === "string") {
    const safe = sanitizeUrlCredentials(value);
    return safe.length > 500 ? `${safe.slice(0, 500)}…` : safe;
  }

  return redactSensitive(value);
}

function resolveToolResultOutput(part: RuntimeStreamPart): unknown {
  if (!isRecord(part) || part.type !== "tool-result") {
    return undefined;
  }

  if ("output" in part) {
    return part.output;
  }

  if ("result" in part) {
    return part.result;
  }

  return undefined;
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
    output: summarizeProviderToolDebugValue(part.output),
    error: summarizeProviderToolDebugValue(part.error),
    input: summarizeProviderToolDebugValue(part.input),
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

function requestStreamIteratorReturn(iterator: AsyncIterator<unknown>): void {
  const returnResult = iterator.return?.();
  if (!returnResult) {
    return;
  }

  void Promise.resolve(returnResult).catch((error) => {
    logger.warn("Runtime stream iterator return failed after local tool-call handoff", {
      error: getStreamErrorMessage(error),
    });
  });
}

export function createStreamState(): ChatStreamState {
  return {
    accumulatedText: "",
    reasoningParts: [],
    finishReason: null,
    toolCalls: new Map(),
    toolResults: [],
    suppressedToolCalls: [],
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
    const reasoningParts = new Map<string, StreamingReasoningPart>();
    let shouldStopForCommittedLocalToolCall = false;
    let hasActiveLocalToolInput = false;
    const providerExecutedToolNames = new Set(callbacks?.providerExecutedToolNames ?? []);
    const availableToolNames = callbacks?.availableToolNames
      ? new Set(callbacks.availableToolNames)
      : null;
    const suppressedToolCallIds = new Set<string>();

    const isUnavailableTool = (toolName: string) =>
      availableToolNames !== null && !availableToolNames.has(toolName);

    const suppressToolCall = (toolCallId: string | undefined, toolName: string) => {
      if (!toolCallId || suppressedToolCallIds.has(toolCallId)) {
        return;
      }
      suppressedToolCallIds.add(toolCallId);
      state.suppressedToolCalls.push({ id: toolCallId, name: toolName });
    };

    const resolveProviderExecuted = (toolName: string, providerExecuted?: boolean) =>
      providerExecuted ?? (providerExecutedToolNames.has(toolName) ? true : undefined);

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
      if (!reasoningParts.has(reasoningId)) {
        const part = { id: reasoningId, text: "" };
        reasoningParts.set(reasoningId, part);
        state.reasoningParts.push(part);
      }
      sendSSE(controller, encoder, {
        type: "reasoning-start",
        id: reasoningId,
      });
    };

    const closeReasoningSegment = () => {
      if (activeReasoningId === null) {
        return;
      }

      const reasoningPart = reasoningParts.get(activeReasoningId);
      sendSSE(controller, encoder, {
        type: "reasoning-end",
        id: activeReasoningId,
        ...(reasoningPart?.signature ? { signature: reasoningPart.signature } : {}),
        ...(reasoningPart?.redactedData ? { redactedData: reasoningPart.redactedData } : {}),
      });
      activeReasoningId = null;
    };

    const commitParseablePendingToolInputs = () => {
      for (const tc of state.toolCalls.values()) {
        if (tc.inputAvailable === true || tc.providerExecuted === true) {
          continue;
        }
        // A bare empty-object placeholder (`""` or `"{}"` after stripping
        // transient prefixes) is provisional streamed input that never
        // finalized into a real `tool-call`/`tool-input-end`. Committing it
        // would mark `inputAvailable: true` and execute the tool with empty
        // args. Leave it provisional so the runtime can recover by re-calling
        // the model instead of executing a placeholder.
        const stripped = stripLeadingEmptyObjectPlaceholder(tc.arguments);
        if (stripped === "" || stripped === "{}") {
          continue;
        }
        const parsedInput = tryParseToolInputObject(tc.arguments);
        if (!parsedInput) {
          continue;
        }
        tc.inputAvailable = true;
        const dynamic = tc.dynamic ?? isDynamicTool(tc.name);
        if (dynamic) {
          tc.dynamic = true;
        }
        announceToolInputStart(tc);
        sendSSE(controller, encoder, {
          type: "tool-input-available",
          toolCallId: tc.id,
          toolName: tc.name,
          input: parsedInput,
          ...(tc.providerExecuted !== undefined ? { providerExecuted: tc.providerExecuted } : {}),
          ...(dynamic ? { dynamic: true } : {}),
        });
        shouldStopForCommittedLocalToolCall = true;
      }
    };

    const announceToolInputStart = (toolCall: StreamingToolCall) => {
      if (toolCall.inputAnnounced === true) {
        return;
      }

      const dynamic = toolCall.dynamic ?? isDynamicTool(toolCall.name);
      sendSSE(controller, encoder, {
        type: "tool-input-start",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        ...(dynamic ? { dynamic: true } : {}),
      });

      for (const delta of toolCall.inputDeltas ?? []) {
        sendSSE(controller, encoder, {
          type: "tool-input-delta",
          toolCallId: toolCall.id,
          inputTextDelta: delta,
        });
      }

      toolCall.inputAnnounced = true;
    };

    const ensureToolLifecycle = (part: {
      toolCallId: string;
      toolName: string;
      input?: unknown;
      providerExecuted?: boolean;
      dynamic?: boolean;
    }) => {
      const dynamic = part.dynamic ?? isDynamicTool(part.toolName);
      const providerExecuted = resolveProviderExecuted(part.toolName, part.providerExecuted);
      const existing = state.toolCalls.get(part.toolCallId);

      if (!existing) {
        const normalizedInput = parseToolInputObject(part.input);
        state.toolCalls.set(part.toolCallId, {
          id: part.toolCallId,
          name: part.toolName,
          arguments: normalizeToolInputString(part.input),
          inputAvailable: true,
          ...(providerExecuted !== undefined ? { providerExecuted } : {}),
          ...(dynamic ? { dynamic: true } : {}),
          inputAnnounced: true,
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
          ...(providerExecuted !== undefined ? { providerExecuted } : {}),
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
      if (providerExecuted !== undefined) {
        existing.providerExecuted = providerExecuted;
      }
      if (dynamic) {
        existing.dynamic = true;
      }

      announceToolInputStart(existing);
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
      const shouldStopForIdleOutput = !hasActiveLocalToolInput &&
        !shouldStopForCommittedLocalToolCall && hasStreamOutput(state);
      const shouldStopForIdleStart = !hasActiveLocalToolInput &&
        !shouldStopForCommittedLocalToolCall && !hasStreamOutput(state);
      const next = hasActiveLocalToolInput
        ? await readNextStreamPartWithTimeout(
          streamIterator,
          state,
          callbacks?.localToolInputIdleTimeoutMs ?? LOCAL_TOOL_INPUT_IDLE_MS,
        )
        : shouldStopForCommittedLocalToolCall
        ? await readNextStreamPartWithTimeout(
          streamIterator,
          state,
          LOCAL_TOOL_COMMIT_GRACE_MS,
        )
        : shouldStopForIdleOutput
        ? await readNextStreamPartWithTimeout(
          streamIterator,
          state,
          callbacks?.streamIdleTimeoutMs ?? STREAM_OUTPUT_IDLE_MS,
        )
        : shouldStopForIdleStart
        ? await readNextStreamPartWithTimeout(
          streamIterator,
          state,
          callbacks?.streamIdleTimeoutMs ?? STREAM_START_IDLE_MS,
        )
        : await readNextStreamPart(streamIterator, state);
      if (next === "timeout") {
        state.finishReason ??= shouldStopForIdleOutput || shouldStopForIdleStart
          ? "stop"
          : "tool-calls";
        requestStreamIteratorReturn(streamIterator);
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
          const reasoningId = normalizeReasoningId(typedPart);
          openReasoningSegment(reasoningId);
          const reasoningPart = reasoningParts.get(reasoningId);
          if (reasoningPart) {
            reasoningPart.text += typeof typedPart.delta === "string" ? typedPart.delta : "";
          }
          sendSSE(controller, encoder, {
            type: "reasoning-delta",
            id: reasoningId,
            delta: typeof typedPart.delta === "string" ? typedPart.delta : "",
          });
          break;
        }

        case "reasoning-end": {
          closeTextSegment();
          if (activeReasoningId === null) {
            activeReasoningId = normalizeReasoningId(typedPart);
          }
          const reasoningPart = reasoningParts.get(activeReasoningId);
          if (reasoningPart) {
            if (typeof typedPart.signature === "string") {
              reasoningPart.signature = typedPart.signature;
            }
            if (typeof typedPart.redactedData === "string") {
              reasoningPart.redactedData = typedPart.redactedData;
            }
          }
          closeReasoningSegment();
          break;
        }

        case "tool-input-start": {
          closeTextSegment();
          closeReasoningSegment();
          shouldStopForCommittedLocalToolCall = false;
          const toolId = typedPart.id;
          if (isUnavailableTool(typedPart.toolName)) {
            suppressToolCall(toolId, typedPart.toolName);
            hasActiveLocalToolInput = false;
            break;
          }
          const providerExecuted = resolveProviderExecuted(
            typedPart.toolName,
            typedPart.providerExecuted,
          );
          hasActiveLocalToolInput = providerExecuted !== true;
          state.toolCalls.set(toolId, {
            id: toolId,
            name: typedPart.toolName,
            arguments: "",
            inputAvailable: false,
            providerExecuted,
            dynamic: typedPart.dynamic,
            inputDeltas: [],
            inputAnnounced: false,
          });
          break;
        }

        case "tool-input-delta": {
          closeReasoningSegment();
          const toolId = typedPart.id;
          if (suppressedToolCallIds.has(toolId)) break;
          const tc = state.toolCalls.get(toolId);
          if (!tc) break;

          tc.arguments = mergeToolInputDelta(tc.arguments, typedPart.delta);
          tc.inputDeltas ??= [];
          tc.inputDeltas.push(typedPart.delta);
          break;
        }

        case "tool-input-end": {
          closeTextSegment();
          closeReasoningSegment();
          const toolId = typedPart.id;
          if (suppressedToolCallIds.has(toolId)) {
            hasActiveLocalToolInput = false;
            break;
          }
          const tc = state.toolCalls.get(toolId);
          if (!tc) break;

          tc.inputAvailable = true;
          hasActiveLocalToolInput = false;
          const dynamic = tc.dynamic ?? isDynamicTool(tc.name);
          if (dynamic) {
            tc.dynamic = true;
          }
          announceToolInputStart(tc);
          sendSSE(controller, encoder, {
            type: "tool-input-available",
            toolCallId: toolId,
            toolName: tc.name,
            input: parseToolInputObject(tc.arguments),
            ...(tc.providerExecuted !== undefined ? { providerExecuted: tc.providerExecuted } : {}),
            ...(dynamic ? { dynamic: true } : {}),
          });
          if (tc.providerExecuted !== true) {
            shouldStopForCommittedLocalToolCall = true;
          }
          break;
        }

        case "tool-input-available": {
          closeTextSegment();
          closeReasoningSegment();
          const toolId = typedPart.toolCallId ?? typedPart.id;
          if (!toolId) {
            break;
          }
          if (isUnavailableTool(typedPart.toolName)) {
            suppressToolCall(toolId, typedPart.toolName);
            hasActiveLocalToolInput = false;
            break;
          }
          const providerExecuted = resolveProviderExecuted(
            typedPart.toolName,
            typedPart.providerExecuted,
          );
          hasActiveLocalToolInput = false;
          const inputStr = normalizeToolInputString(typedPart.input);
          const previous = state.toolCalls.get(toolId);
          const previousArguments = previous?.arguments ?? "";
          const resolvedArguments = mergeToolCallInput(previousArguments, inputStr);
          const wasInputAvailable = previous?.inputAvailable === true;
          const dynamic = typedPart.dynamic ?? isDynamicTool(typedPart.toolName);
          state.toolCalls.set(toolId, {
            id: toolId,
            name: typedPart.toolName,
            arguments: resolvedArguments,
            inputAvailable: true,
            providerExecuted,
            dynamic,
          });

          if (!wasInputAvailable) {
            sendSSE(controller, encoder, {
              type: "tool-input-available",
              toolCallId: toolId,
              toolName: typedPart.toolName,
              input: parseToolInputObject(resolvedArguments),
              ...(providerExecuted !== undefined ? { providerExecuted } : {}),
              ...(dynamic ? { dynamic: true } : {}),
            });
          }
          if (providerExecuted !== true) {
            shouldStopForCommittedLocalToolCall = true;
          }
          break;
        }

        case "tool-call": {
          closeTextSegment();
          closeReasoningSegment();
          // tool-call fires when the full tool call is available
          const toolId = typedPart.toolCallId;
          if (isUnavailableTool(typedPart.toolName)) {
            suppressToolCall(toolId, typedPart.toolName);
            hasActiveLocalToolInput = false;
            break;
          }
          const providerExecuted = resolveProviderExecuted(
            typedPart.toolName,
            typedPart.providerExecuted,
          );
          hasActiveLocalToolInput = false;
          const inputStr = normalizeToolInputString(typedPart.input);
          const previous = state.toolCalls.get(toolId);
          const previousArguments = previous?.arguments ?? "";
          const resolvedArguments = mergeToolCallInput(previousArguments, inputStr);
          const wasInputAvailable = previous?.inputAvailable === true;
          const toolCall: StreamingToolCall = {
            id: toolId,
            name: typedPart.toolName,
            arguments: resolvedArguments,
            inputDeltas: previous?.inputDeltas ?? [],
            inputAnnounced: previous?.inputAnnounced ?? false,
            inputAvailable: true,
            providerExecuted,
            dynamic: typedPart.dynamic,
          };
          state.toolCalls.set(toolId, toolCall);

          const dynamic = isDynamicTool(typedPart.toolName);
          const inputObj = parseToolInputObject(typedPart.input);
          announceToolInputStart(toolCall);
          if (!wasInputAvailable) {
            sendSSE(controller, encoder, {
              type: "tool-input-available",
              toolCallId: toolId,
              toolName: typedPart.toolName,
              input: inputObj,
              ...(providerExecuted !== undefined ? { providerExecuted } : {}),
              ...(dynamic ? { dynamic: true } : {}),
            });
          }
          if (providerExecuted !== true) {
            shouldStopForCommittedLocalToolCall = true;
          }
          break;
        }

        case "tool-result": {
          closeTextSegment();
          closeReasoningSegment();
          if (
            suppressedToolCallIds.has(typedPart.toolCallId) ||
            isUnavailableTool(typedPart.toolName)
          ) {
            suppressToolCall(typedPart.toolCallId, typedPart.toolName);
            break;
          }
          const providerExecuted = resolveProviderExecuted(
            typedPart.toolName,
            typedPart.providerExecuted,
          );
          ensureToolLifecycle({
            toolCallId: typedPart.toolCallId,
            toolName: typedPart.toolName,
            input: typedPart.input,
            providerExecuted,
            dynamic: typedPart.dynamic,
          });
          const toolResultOutput = resolveToolResultOutput(typedPart);
          const isError = typedPart.isError === true;
          logProviderToolPart("tool-result", {
            toolCallId: typedPart.toolCallId,
            toolName: typedPart.toolName,
            providerExecuted,
            dynamic: typedPart.dynamic,
            output: toolResultOutput,
            input: typedPart.input,
            preliminary: typedPart.preliminary,
            isError,
          });
          if (isError) {
            state.toolResults.push({
              toolCallId: typedPart.toolCallId,
              toolName: typedPart.toolName,
              error: toolResultOutput,
              ...(providerExecuted !== undefined ? { providerExecuted } : {}),
              ...(typedPart.dynamic ? { dynamic: true } : {}),
            });
            sendSSE(controller, encoder, {
              type: "tool-output-error",
              toolCallId: typedPart.toolCallId,
              errorText: stringifyToolError(toolResultOutput),
              ...(providerExecuted !== undefined ? { providerExecuted } : {}),
              ...(typedPart.dynamic ? { dynamic: true } : {}),
            });
            break;
          }

          state.toolResults.push({
            toolCallId: typedPart.toolCallId,
            toolName: typedPart.toolName,
            output: toolResultOutput,
            ...(providerExecuted !== undefined ? { providerExecuted } : {}),
            ...(typedPart.dynamic ? { dynamic: true } : {}),
            ...(typedPart.preliminary !== undefined ? { preliminary: typedPart.preliminary } : {}),
          });
          sendSSE(controller, encoder, {
            type: "tool-output-available",
            toolCallId: typedPart.toolCallId,
            output: toolResultOutput,
            ...(providerExecuted !== undefined ? { providerExecuted } : {}),
            ...(typedPart.dynamic ? { dynamic: true } : {}),
            ...(typedPart.preliminary !== undefined ? { preliminary: typedPart.preliminary } : {}),
          });
          break;
        }

        case "tool-error": {
          closeTextSegment();
          closeReasoningSegment();
          const providerExecuted = resolveProviderExecuted(
            typedPart.toolName,
            typedPart.providerExecuted,
          );
          ensureToolLifecycle({
            toolCallId: typedPart.toolCallId,
            toolName: typedPart.toolName,
            input: typedPart.input,
            providerExecuted,
            dynamic: typedPart.dynamic,
          });
          logProviderToolPart("tool-error", {
            toolCallId: typedPart.toolCallId,
            toolName: typedPart.toolName,
            providerExecuted,
            dynamic: typedPart.dynamic,
            error: typedPart.error,
            input: typedPart.input,
          });
          state.toolResults.push({
            toolCallId: typedPart.toolCallId,
            toolName: typedPart.toolName,
            error: typedPart.error,
            ...(providerExecuted !== undefined ? { providerExecuted } : {}),
            ...(typedPart.dynamic ? { dynamic: true } : {}),
          });
          sendSSE(controller, encoder, {
            type: "tool-output-error",
            toolCallId: typedPart.toolCallId,
            errorText: stringifyToolError(typedPart.error),
            ...(providerExecuted !== undefined ? { providerExecuted } : {}),
            ...(typedPart.dynamic ? { dynamic: true } : {}),
          });
          break;
        }

        case "finish": {
          closeTextSegment();
          closeReasoningSegment();
          state.finishReason = typedPart.finishReason ?? null;
          if (state.finishReason === "tool-calls") {
            commitParseablePendingToolInputs();
          }
          if (typedPart.totalUsage) {
            const input = typedPart.totalUsage.inputTokens ?? 0;
            const output = typedPart.totalUsage.outputTokens ?? 0;
            const cacheReadInputTokens = typedPart.totalUsage.cacheReadInputTokens;
            const cacheCreationInputTokens = typedPart.totalUsage.cacheCreationInputTokens;
            const cachedInputTokens = typedPart.totalUsage.cachedInputTokens ??
              cacheReadInputTokens;
            state.usage = {
              promptTokens: input,
              completionTokens: output,
              totalTokens: typedPart.totalUsage.totalTokens ?? input + output,
              ...(cachedInputTokens !== undefined ? { cachedInputTokens } : {}),
              ...(cacheCreationInputTokens !== undefined ? { cacheCreationInputTokens } : {}),
              ...(cacheReadInputTokens !== undefined ? { cacheReadInputTokens } : {}),
              ...(typedPart.totalUsage.reasoningTokens !== undefined
                ? { reasoningTokens: typedPart.totalUsage.reasoningTokens }
                : {}),
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
