import {
  mergeToolInputDelta,
  parseToolInputObject,
  stripLeadingEmptyObjectPlaceholder,
} from "../streaming/data-stream.ts";
import type { AgUiRuntimeStreamEvent } from "./browser-encoder.ts";
import type { ChatFinishReason, ChatStreamEvent } from "#veryfront/chat/protocol.ts";

export interface AgUiRuntimeChatStreamEncoderState {
  isStepOpen: boolean;
  finishReason: ChatFinishReason;
}

export interface AgUiRuntimeChatStreamEncoder {
  state: AgUiRuntimeChatStreamEncoderState;
  encode: (event: AgUiRuntimeStreamEvent) => ChatStreamEvent[];
}

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

function getStringField(event: AgUiRuntimeStreamEvent, key: string): string | undefined {
  const value = event[key];
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export function createAgUiRuntimeChatStreamEncoder(
  options: CreateAgUiRuntimeChatStreamEncoderOptions,
): AgUiRuntimeChatStreamEncoder {
  const state: AgUiRuntimeChatStreamEncoderState = {
    isStepOpen: false,
    finishReason: "stop",
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
        case "message-finish":
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
            events.push({ type: "text-start", id: options.responseMessageId });
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
            events.push({ type: "text-start", id: options.responseMessageId });
          }
          events.push({ type: "text-delta", id: options.responseMessageId, delta });
          return events;
        }
        case "text-end": {
          const id = getStringField(event, "id") ?? options.responseMessageId;
          if (startedTextBlockIds.has(id)) {
            startedTextBlockIds.delete(id);
            events.push({ type: "text-end", id: options.responseMessageId });
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
        default:
          return events;
      }
    },
  };
}
