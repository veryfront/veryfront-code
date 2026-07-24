import type { StreamLifecycleFrame } from "#veryfront/agent/streaming/lifecycle/index.ts";
import { normalizeConversationRunEvents } from "./run-event-normalization.ts";
import { type ConversationRunEvent, conversationRunEventTypes } from "./run-events.ts";

/**
 * Thrown when a supposedly validated lifecycle frame sequence violates a
 * projection invariant. Version 2 projection never synthesizes lifecycle
 * boundaries; repair belongs to the reducer or the legacy read adapter.
 */
export class StreamProjectionInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StreamProjectionInvariantError";
  }
}

/** Buffered durable projection of validated lifecycle frames. */
export interface LifecycleRunEventAdapter {
  handleFrame(frame: StreamLifecycleFrame): void;
  flush(): void;
  dispose(): void;
}

type PendingDurableContent = {
  type: "TEXT_MESSAGE_CONTENT" | "REASONING_MESSAGE_CONTENT" | "TOOL_CALL_ARGS";
  identity: string;
  event: ConversationRunEvent;
  delta: string;
};

const DEFAULT_MAX_BUFFERED_CONTENT_BYTES = 32 * 1024;
const DEFAULT_FLUSH_DELAY_MS = 250;

export function createLifecycleRunEventAdapter(input: {
  runId: string;
  attemptId: string;
  attemptIndex: number;
  messageId: string;
  onEvents(events: readonly ConversationRunEvent[]): void;
  maxBufferedContentBytes?: number;
  flushDelayMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => number;
  clearTimer?: (timerId: number) => void;
}): LifecycleRunEventAdapter {
  const maxBufferedContentBytes = input.maxBufferedContentBytes ??
    DEFAULT_MAX_BUFFERED_CONTENT_BYTES;
  const flushDelayMs = input.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
  const setTimer = input.setTimer ??
    ((callback: () => void, delayMs: number) =>
      globalThis.setTimeout(callback, delayMs) as unknown as number);
  const clearTimer = input.clearTimer ??
    ((timerId: number) =>
      globalThis.clearTimeout(
        timerId as unknown as ReturnType<
          typeof globalThis.setTimeout
        >,
      ));

  let logicalSequence = 0;
  let pending: PendingDurableContent | null = null;
  let flushTimerId: number | null = null;
  let disposed = false;
  const openToolCalls = new Map<string, string>();
  const toolInputs = new Map<string, unknown>();
  const streamedToolInputs = new Set<string>();
  const lastToolStatus = new Map<string, string>();
  const openTextIds = new Set<string>();
  const openReasoningIds = new Set<string>();

  const clearFlushTimer = () => {
    if (flushTimerId !== null) {
      clearTimer(flushTimerId);
      flushTimerId = null;
    }
  };

  const publish = (rawEvents: ConversationRunEvent[]): void => {
    const normalized = normalizeConversationRunEvents(rawEvents);
    const versioned = normalized.map((event) => {
      const sequence = ++logicalSequence;
      return {
        ...event,
        stream_protocol_version: 2,
        attempt_id: input.attemptId,
        attempt_index: input.attemptIndex,
        logical_sequence: sequence,
        idempotency_key: `stream-v2:${input.runId}:${input.attemptId}:${sequence}`,
      };
    });
    if (versioned.length > 0) input.onEvents(versioned);
  };

  const flushPending = (): void => {
    clearFlushTimer();
    if (pending === null) return;
    const buffered = pending;
    pending = null;
    publish([{ ...buffered.event, delta: buffered.delta }]);
  };

  const bufferContent = (content: PendingDurableContent): void => {
    if (
      pending !== null &&
      (pending.type !== content.type || pending.identity !== content.identity)
    ) {
      flushPending();
    }
    if (pending === null) {
      pending = content;
      if (flushTimerId === null) {
        flushTimerId = setTimer(() => {
          flushTimerId = null;
          flushPending();
        }, flushDelayMs);
      }
    } else {
      pending.delta += content.delta;
    }
    if (pending.delta.length >= maxBufferedContentBytes) {
      flushPending();
    }
  };

  const emit = (event: ConversationRunEvent): void => {
    flushPending();
    publish([event]);
  };

  const serialize = (value: unknown): string => {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value ?? null);
    } catch {
      return String(value);
    }
  };

  const handleSemantic = (
    event: Extract<StreamLifecycleFrame, { class: "semantic" }>["event"],
  ): void => {
    switch (event.type) {
      case "text_start":
        openTextIds.add(event.id ?? "text");
        emit({
          type: conversationRunEventTypes.textMessageStart,
          messageId: input.messageId,
          contentId: event.id ?? "text",
          role: "assistant",
        });
        return;
      case "text_content": {
        const contentId = event.id ?? "text";
        if (!openTextIds.has(contentId)) {
          throw new StreamProjectionInvariantError(
            "Text content arrived without an open text segment",
          );
        }
        bufferContent({
          type: "TEXT_MESSAGE_CONTENT",
          identity: contentId,
          event: {
            type: conversationRunEventTypes.textMessageContent,
            messageId: input.messageId,
            contentId,
          },
          delta: event.delta,
        });
        return;
      }
      case "text_end":
        openTextIds.delete(event.id ?? "text");
        emit({
          type: conversationRunEventTypes.textMessageEnd,
          messageId: input.messageId,
          contentId: event.id ?? "text",
        });
        return;
      case "reasoning_start":
        openReasoningIds.add(event.id);
        emit({
          type: conversationRunEventTypes.reasoningMessageStart,
          messageId: input.messageId,
          contentId: event.id,
        });
        return;
      case "reasoning_content":
        if (!openReasoningIds.has(event.id)) {
          throw new StreamProjectionInvariantError(
            "Reasoning content arrived without an open reasoning segment",
          );
        }
        bufferContent({
          type: "REASONING_MESSAGE_CONTENT",
          identity: event.id,
          event: {
            type: conversationRunEventTypes.reasoningMessageContent,
            messageId: input.messageId,
            contentId: event.id,
          },
          delta: event.delta,
        });
        return;
      case "reasoning_end":
        openReasoningIds.delete(event.id);
        emit({
          type: conversationRunEventTypes.reasoningMessageEnd,
          messageId: input.messageId,
          contentId: event.id,
        });
        return;
      case "tool_input_start":
        openToolCalls.set(event.toolCallId, event.toolName);
        emit({
          type: conversationRunEventTypes.toolCallStart,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          messageId: input.messageId,
        });
        return;
      case "tool_input_content":
        if (!openToolCalls.has(event.toolCallId)) {
          throw new StreamProjectionInvariantError(
            "Tool input content arrived without an open tool call",
          );
        }
        bufferContent({
          type: "TOOL_CALL_ARGS",
          identity: event.toolCallId,
          event: {
            type: conversationRunEventTypes.toolCallArgs,
            toolCallId: event.toolCallId,
          },
          delta: event.delta,
        });
        streamedToolInputs.add(event.toolCallId);
        return;
      case "tool_input_ready":
        if (!openToolCalls.has(event.toolCallId)) {
          throw new StreamProjectionInvariantError(
            "Tool input ready arrived without an open tool call",
          );
        }
        toolInputs.set(event.toolCallId, event.input);
        if (!streamedToolInputs.has(event.toolCallId)) {
          emit({
            type: conversationRunEventTypes.toolCallArgs,
            toolCallId: event.toolCallId,
            delta: serialize(event.input),
          });
        }
        emit({
          type: conversationRunEventTypes.toolCallEnd,
          toolCallId: event.toolCallId,
        });
        openToolCalls.delete(event.toolCallId);
        streamedToolInputs.delete(event.toolCallId);
        return;
      case "tool_input_rejected": {
        if (event.reason === "unavailable") {
          // The Provider Adapter rejected the tool before a canonical tool
          // input opened; balanced durable history records nothing.
          return;
        }
        if (!openToolCalls.has(event.toolCallId)) {
          throw new StreamProjectionInvariantError(
            "Tool input rejection arrived without an open tool call",
          );
        }
        emit({
          type: conversationRunEventTypes.toolCallEnd,
          toolCallId: event.toolCallId,
        });
        emit({
          type: conversationRunEventTypes.toolCallResult,
          toolCallId: event.toolCallId,
          toolName: openToolCalls.get(event.toolCallId),
          content: "Tool input was rejected before handoff",
          isError: true,
        });
        openToolCalls.delete(event.toolCallId);
        toolInputs.delete(event.toolCallId);
        streamedToolInputs.delete(event.toolCallId);
        return;
      }
      case "provider_tool_start":
        return;
      case "provider_tool_result": {
        const storedInput = toolInputs.get(event.toolCallId);
        emit({
          type: conversationRunEventTypes.toolCallResult,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          content: serialize(event.output),
          isError: event.isError,
          ...(storedInput !== undefined ? { input: storedInput } : {}),
        });
        openToolCalls.delete(event.toolCallId);
        toolInputs.delete(event.toolCallId);
        streamedToolInputs.delete(event.toolCallId);
        return;
      }
      case "provider_tool_denied":
      case "provider_tool_cancelled": {
        const storedInput = toolInputs.get(event.toolCallId);
        emit({
          type: conversationRunEventTypes.toolCallResult,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          content: event.type === "provider_tool_denied"
            ? "Tool output denied"
            : "Provider tool execution was cancelled",
          isError: true,
          ...(storedInput !== undefined ? { input: storedInput } : {}),
        });
        openToolCalls.delete(event.toolCallId);
        toolInputs.delete(event.toolCallId);
        streamedToolInputs.delete(event.toolCallId);
        return;
      }
      case "custom":
        emit({
          type: conversationRunEventTypes.custom,
          name: event.name,
          value: event.data,
        });
        return;
      case "message_start":
      case "step_start":
        return;
      case "step_finish":
      case "usage":
        flushPending();
        return;
    }
  };

  return {
    handleFrame(frame: StreamLifecycleFrame) {
      if (disposed) return;
      if (frame.class === "diagnostic") return;
      if (frame.class === "telemetry") {
        if (frame.event.type !== "tool_input_status") return;
        const { toolCallId, status } = frame.event;
        if (lastToolStatus.get(toolCallId) === status) return;
        lastToolStatus.set(toolCallId, status);
        emit({
          type: conversationRunEventTypes.custom,
          name: "tool-call-status",
          value: { toolCallId, status },
        });
        return;
      }
      handleSemantic(frame.event);
    },
    flush() {
      flushPending();
    },
    dispose() {
      if (disposed) return;
      flushPending();
      disposed = true;
    },
  };
}
