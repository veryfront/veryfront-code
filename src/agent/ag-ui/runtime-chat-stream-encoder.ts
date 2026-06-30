import {
  mergeToolInputDelta,
  parseToolInputObject,
  stripLeadingEmptyObjectPlaceholder,
} from "../streaming/data-stream.ts";
import type { AgUiRuntimeStreamEvent } from "./browser-encoder.ts";
import type { ChatFinishReason, ChatStreamEvent } from "#veryfront/chat/protocol.ts";
import { mapFinishReason } from "../../chat/ag-ui-helpers.ts";

/** Usage metadata captured from an AG-UI runtime finish event. */
export type AgUiRuntimeChatStreamUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputTokenDetails: {
    noCacheTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
  outputTokenDetails: {
    textTokens?: number;
    reasoningTokens?: number;
  };
  billableInputTokens?: number;
  billableOutputTokens?: number;
  costUsd?: number;
  providerInputCostUsd?: number;
  providerOutputCostUsd?: number;
  providerCostUsd?: number;
  veryfrontInputChargeUsd?: number;
  veryfrontOutputChargeUsd?: number;
  veryfrontChargeUsd?: number;
  veryfrontBilledUsd?: number;
  costCredits?: number;
  costSource?: "gateway" | "missing" | "partial";
  billingMode?: "direct" | "deferred";
  usageCaptureStatus?: "complete" | "partial" | "missing";
};

/** State for AG-UI runtime chat stream encoder. */
export interface AgUiRuntimeChatStreamEncoderState {
  isStepOpen: boolean;
  finishReason: ChatFinishReason;
  totalUsage: AgUiRuntimeChatStreamUsage | null;
}

/** Public API contract for AG-UI runtime chat stream encoder. */
export interface AgUiRuntimeChatStreamEncoder {
  state: AgUiRuntimeChatStreamEncoderState;
  encode: (event: AgUiRuntimeStreamEvent) => ChatStreamEvent[];
}

/** Options accepted by create AG-UI runtime chat stream encoder. */
export interface CreateAgUiRuntimeChatStreamEncoderOptions {
  responseMessageId: string;
  sendReasoning?: boolean;
  onError?: (error: unknown) => string;
}

type ToolPart = {
  toolName: string;
  inputText: string;
  input: Record<string, unknown>;
};

type PendingToolDelta = {
  inputText: string;
  chunks: string[];
};

function createTextChunk(
  type: "text-start" | "text-end",
  responseMessageId: string,
  blockId: string,
): ChatStreamEvent {
  return {
    type,
    id: responseMessageId,
    contentId: blockId,
  };
}

function createTextDeltaChunk(
  responseMessageId: string,
  blockId: string,
  delta: string,
): ChatStreamEvent {
  return {
    type: "text-delta",
    id: responseMessageId,
    contentId: blockId,
    delta,
  };
}

function getStringField(event: AgUiRuntimeStreamEvent, key: string): string | undefined {
  const value = event[key];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getNumberField(value: Record<string, unknown>, key: string): number | undefined {
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}

function getDataRecord(event: AgUiRuntimeStreamEvent): Record<string, unknown> | undefined {
  return isRecord(event.data) ? event.data : undefined;
}

function getToolInput(event: AgUiRuntimeStreamEvent): Record<string, unknown> {
  return parseToolInputObject(event.input);
}

function parseStreamedToolInput(inputText: string): Record<string, unknown> | null {
  const normalizedInputText = stripLeadingEmptyObjectPlaceholder(inputText).trim();
  if (normalizedInputText.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(normalizedInputText);
    return isRecord(parsed) ? Object.fromEntries(Object.entries(parsed)) : {};
  } catch {
    return null;
  }
}

function isEmptyRecord(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === 0;
}

function formatErrorText(error: unknown, onError?: (error: unknown) => string): string {
  return onError ? onError(error) : error instanceof Error ? error.message : String(error);
}

function getFinishUsage(event: AgUiRuntimeStreamEvent): AgUiRuntimeChatStreamUsage | null {
  const usage = isRecord(event.totalUsage)
    ? event.totalUsage
    : isRecord(event.usage)
    ? event.usage
    : null;
  if (!usage) {
    return null;
  }

  const inputTokenDetails = isRecord(usage.inputTokenDetails) ? usage.inputTokenDetails : {};
  const outputTokenDetails = isRecord(usage.outputTokenDetails) ? usage.outputTokenDetails : {};
  const inputTokens = getNumberField(usage, "inputTokens") ??
    getNumberField(usage, "promptTokens") ??
    0;
  const outputTokens = getNumberField(usage, "outputTokens") ??
    getNumberField(usage, "completionTokens") ??
    0;
  const cacheReadTokens = getNumberField(inputTokenDetails, "cacheReadTokens") ??
    getNumberField(usage, "cacheReadInputTokens") ??
    getNumberField(usage, "cachedInputTokens");
  const cacheWriteTokens = getNumberField(inputTokenDetails, "cacheWriteTokens") ??
    getNumberField(usage, "cacheCreationInputTokens");
  const reasoningTokens = getNumberField(outputTokenDetails, "reasoningTokens") ??
    getNumberField(usage, "reasoningTokens");

  return {
    inputTokens,
    outputTokens,
    totalTokens: getNumberField(usage, "totalTokens") ?? inputTokens + outputTokens,
    inputTokenDetails: {
      ...(getNumberField(inputTokenDetails, "noCacheTokens") !== undefined
        ? { noCacheTokens: getNumberField(inputTokenDetails, "noCacheTokens") }
        : {}),
      ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
      ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
    },
    outputTokenDetails: {
      ...(getNumberField(outputTokenDetails, "textTokens") !== undefined
        ? { textTokens: getNumberField(outputTokenDetails, "textTokens") }
        : {}),
      ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    },
    ...(getNumberField(usage, "billableInputTokens") !== undefined
      ? { billableInputTokens: getNumberField(usage, "billableInputTokens") }
      : {}),
    ...(getNumberField(usage, "billableOutputTokens") !== undefined
      ? { billableOutputTokens: getNumberField(usage, "billableOutputTokens") }
      : {}),
    ...(getNumberField(usage, "costUsd") !== undefined
      ? { costUsd: getNumberField(usage, "costUsd") }
      : {}),
    ...(getNumberField(usage, "providerInputCostUsd") !== undefined
      ? { providerInputCostUsd: getNumberField(usage, "providerInputCostUsd") }
      : {}),
    ...(getNumberField(usage, "providerOutputCostUsd") !== undefined
      ? { providerOutputCostUsd: getNumberField(usage, "providerOutputCostUsd") }
      : {}),
    ...(getNumberField(usage, "providerCostUsd") !== undefined
      ? { providerCostUsd: getNumberField(usage, "providerCostUsd") }
      : {}),
    ...(getNumberField(usage, "veryfrontInputChargeUsd") !== undefined
      ? { veryfrontInputChargeUsd: getNumberField(usage, "veryfrontInputChargeUsd") }
      : {}),
    ...(getNumberField(usage, "veryfrontOutputChargeUsd") !== undefined
      ? { veryfrontOutputChargeUsd: getNumberField(usage, "veryfrontOutputChargeUsd") }
      : {}),
    ...(getNumberField(usage, "veryfrontChargeUsd") !== undefined
      ? { veryfrontChargeUsd: getNumberField(usage, "veryfrontChargeUsd") }
      : {}),
    ...(getNumberField(usage, "veryfrontBilledUsd") !== undefined
      ? { veryfrontBilledUsd: getNumberField(usage, "veryfrontBilledUsd") }
      : {}),
    ...(getNumberField(usage, "costCredits") !== undefined
      ? { costCredits: getNumberField(usage, "costCredits") }
      : {}),
    ...(usage.costSource === "gateway" || usage.costSource === "missing" ||
        usage.costSource === "partial"
      ? { costSource: usage.costSource }
      : {}),
    ...(usage.billingMode === "direct" || usage.billingMode === "deferred"
      ? { billingMode: usage.billingMode }
      : {}),
    ...(usage.usageCaptureStatus === "complete" || usage.usageCaptureStatus === "partial" ||
        usage.usageCaptureStatus === "missing"
      ? { usageCaptureStatus: usage.usageCaptureStatus }
      : {}),
  };
}

function observeFinishEvent(
  state: AgUiRuntimeChatStreamEncoderState,
  event: AgUiRuntimeStreamEvent,
): void {
  const finishReason = typeof event.finishReason === "string"
    ? mapFinishReason(event.finishReason)
    : undefined;
  if (finishReason) {
    state.finishReason = finishReason;
  }

  const usage = getFinishUsage(event);
  if (usage) {
    state.totalUsage = usage;
  }
}

/** Create AG-UI runtime chat stream encoder. */
export function createAgUiRuntimeChatStreamEncoder(
  options: CreateAgUiRuntimeChatStreamEncoderOptions,
): AgUiRuntimeChatStreamEncoder {
  const state: AgUiRuntimeChatStreamEncoderState = {
    isStepOpen: false,
    finishReason: "stop",
    totalUsage: null,
  };
  const startedTextBlockIds = new Set<string>();
  const seenTextBlockIds = new Set<string>();
  const emittedToolInputStartIds = new Set<string>();
  const toolParts = new Map<string, ToolPart>();
  const pendingToolDeltas = new Map<string, PendingToolDelta>();

  const ensureStepStarted = (events: ChatStreamEvent[]) => {
    if (state.isStepOpen) {
      return;
    }
    state.isStepOpen = true;
    events.push({ type: "start-step" });
  };

  const appendPendingToolDelta = (toolCallId: string, inputTextDelta: string) => {
    const existing = pendingToolDeltas.get(toolCallId);
    if (existing) {
      existing.inputText = mergeToolInputDelta(existing.inputText, inputTextDelta);
      existing.chunks.push(inputTextDelta);
      return;
    }

    pendingToolDeltas.set(toolCallId, {
      inputText: inputTextDelta,
      chunks: [inputTextDelta],
    });
  };

  const flushPendingToolDeltas = (toolCallId: string): ChatStreamEvent[] => {
    const pending = pendingToolDeltas.get(toolCallId);
    if (!pending) {
      return [];
    }
    pendingToolDeltas.delete(toolCallId);
    return pending.chunks.map((inputTextDelta) => ({
      type: "tool-input-delta",
      toolCallId,
      inputTextDelta,
    }));
  };

  return {
    state,
    encode: (event) => {
      const events: ChatStreamEvent[] = [];

      switch (event.type) {
        case "message-start":
          return events;
        case "message-finish":
        case "finish":
          observeFinishEvent(state, event);
          return events;
        case "step-start":
          ensureStepStarted(events);
          return events;
        case "step-end":
          if (state.isStepOpen) {
            state.isStepOpen = false;
            events.push({ type: "finish-step" });
          }
          return events;
        case "text-start": {
          ensureStepStarted(events);
          const id = getStringField(event, "id") ?? options.responseMessageId;
          if (!seenTextBlockIds.has(id)) {
            seenTextBlockIds.add(id);
          } else if (startedTextBlockIds.has(id)) {
            events.push(createTextChunk("text-start", options.responseMessageId, id));
          }
          return events;
        }
        case "text-delta": {
          ensureStepStarted(events);
          const id = getStringField(event, "id") ?? options.responseMessageId;
          const delta = getStringField(event, "delta") ?? "";
          if (delta.length === 0) {
            return events;
          }
          if (!startedTextBlockIds.has(id)) {
            startedTextBlockIds.add(id);
            seenTextBlockIds.add(id);
            events.push(createTextChunk("text-start", options.responseMessageId, id));
          }
          events.push(createTextDeltaChunk(options.responseMessageId, id, delta));
          return events;
        }
        case "text-end": {
          const id = getStringField(event, "id") ?? options.responseMessageId;
          if (startedTextBlockIds.has(id)) {
            startedTextBlockIds.delete(id);
            events.push(createTextChunk("text-end", options.responseMessageId, id));
          }
          return events;
        }
        case "reasoning-start": {
          ensureStepStarted(events);
          const id = getStringField(event, "id") ?? crypto.randomUUID();
          events.push({ type: "reasoning-start", id });
          return events;
        }
        case "reasoning-delta": {
          ensureStepStarted(events);
          if (options.sendReasoning === false) {
            return events;
          }
          const id = getStringField(event, "id") ?? crypto.randomUUID();
          const delta = getStringField(event, "delta") ?? "";
          if (delta.length > 0) {
            events.push({ type: "reasoning-delta", id, delta });
          }
          return events;
        }
        case "reasoning-end": {
          const id = getStringField(event, "id");
          if (id) {
            events.push({ type: "reasoning-end", id });
          }
          return events;
        }
        case "tool-input-start": {
          ensureStepStarted(events);
          const toolCallId = getStringField(event, "toolCallId");
          const toolName = getStringField(event, "toolName");
          if (!toolCallId || !toolName) {
            return events;
          }
          const toolPart = toolParts.get(toolCallId);
          if (!toolPart) {
            toolParts.set(toolCallId, {
              toolName,
              inputText: "",
              input: {},
            });
          }
          if (!emittedToolInputStartIds.has(toolCallId)) {
            emittedToolInputStartIds.add(toolCallId);
            events.push({ type: "tool-input-start", toolCallId, toolName });
          }
          const pendingEvents = flushPendingToolDeltas(toolCallId);
          const existingToolPart = toolParts.get(toolCallId);
          if (existingToolPart) {
            for (const pendingEvent of pendingEvents) {
              if (pendingEvent.type === "tool-input-delta") {
                existingToolPart.inputText = mergeToolInputDelta(
                  existingToolPart.inputText,
                  pendingEvent.inputTextDelta,
                );
                const parsedInput = parseStreamedToolInput(existingToolPart.inputText);
                if (parsedInput) {
                  existingToolPart.input = parsedInput;
                }
              }
            }
          }
          events.push(...pendingEvents);
          return events;
        }
        case "tool-input-delta": {
          ensureStepStarted(events);
          const toolCallId = getStringField(event, "toolCallId");
          const inputTextDelta = getStringField(event, "inputTextDelta") ??
            getStringField(event, "delta") ?? "";
          if (!toolCallId || inputTextDelta.length === 0) {
            return events;
          }
          const toolPart = toolParts.get(toolCallId);
          if (!toolPart) {
            appendPendingToolDelta(toolCallId, inputTextDelta);
            return events;
          }
          toolPart.inputText = mergeToolInputDelta(toolPart.inputText, inputTextDelta);
          const parsedInput = parseStreamedToolInput(toolPart.inputText);
          if (parsedInput) {
            toolPart.input = parsedInput;
          }
          events.push({ type: "tool-input-delta", toolCallId, inputTextDelta });
          return events;
        }
        case "tool-input-available": {
          ensureStepStarted(events);
          const toolCallId = getStringField(event, "toolCallId");
          const toolName = getStringField(event, "toolName");
          if (!toolCallId || !toolName) {
            return events;
          }
          const inputRecord = getToolInput(event);
          const existingToolPart = toolParts.get(toolCallId);
          const pendingToolDelta = pendingToolDeltas.get(toolCallId);
          const pendingInputText = pendingToolDelta?.inputText ?? "";
          const parsedPendingInput = pendingInputText.length > 0
            ? parseStreamedToolInput(pendingInputText)
            : null;
          const resolvedInputRecord = isEmptyRecord(inputRecord)
            ? existingToolPart && !isEmptyRecord(existingToolPart.input)
              ? existingToolPart.input
              : parsedPendingInput && !isEmptyRecord(parsedPendingInput)
              ? parsedPendingInput
              : inputRecord
            : inputRecord;

          if (existingToolPart) {
            existingToolPart.toolName = toolName;
            existingToolPart.inputText = pendingInputText;
            existingToolPart.input = resolvedInputRecord;
          } else {
            toolParts.set(toolCallId, {
              toolName,
              inputText: pendingInputText,
              input: resolvedInputRecord,
            });
          }

          if (!emittedToolInputStartIds.has(toolCallId)) {
            emittedToolInputStartIds.add(toolCallId);
            events.push({ type: "tool-input-start", toolCallId, toolName });
          }
          events.push(...flushPendingToolDeltas(toolCallId));
          events.push({
            type: "tool-input-available",
            toolCallId,
            toolName,
            input: resolvedInputRecord,
          });
          return events;
        }
        case "tool-output-available": {
          ensureStepStarted(events);
          const toolCallId = getStringField(event, "toolCallId");
          if (!toolCallId) {
            return events;
          }
          events.push({ type: "tool-output-available", toolCallId, output: event.output });
          return events;
        }
        case "tool-output-error": {
          ensureStepStarted(events);
          const toolCallId = getStringField(event, "toolCallId");
          if (!toolCallId) {
            return events;
          }
          const errorText = getStringField(event, "errorText") ?? "Tool execution failed";
          events.push({ type: "tool-output-error", toolCallId, errorText });
          return events;
        }
        case "data": {
          const data = getDataRecord(event);
          const name = typeof data?.name === "string" && data.name.length > 0
            ? data.name
            : undefined;
          if (name) {
            const dataValue = data && Object.hasOwn(data, "value") ? data.value : undefined;
            events.push({
              type: `data-${name}`,
              data: dataValue,
            });
            return events;
          }
          if (data && typeof data.model === "string") {
            events.push({ type: "message-metadata", messageMetadata: { modelId: data.model } });
          }
          return events;
        }
        case "error": {
          state.finishReason = "error";
          events.push({
            type: "error",
            errorText: formatErrorText(
              getStringField(event, "error") ?? "Framework stream failed",
              options.onError,
            ),
          });
          return events;
        }
        default: {
          if (!event.type.startsWith("data-")) {
            return events;
          }
          events.push({
            type: event.type as `data-${string}`,
            data: event.data,
          });
          return events;
        }
      }
    },
  };
}
