import type { ChatMessageMetadata, ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";
import { toChildRunToolInputRecord } from "../child-run/execution-support.ts";

/** Public API contract for hosted child pending tool call phase. */
export type HostedChildPendingToolCallPhase = "input_streaming" | "awaiting_result";

/** State for hosted child pending tool call. */
export interface HostedChildPendingToolCallState {
  /** Phase value. */
  phase: HostedChildPendingToolCallPhase;
  /** Tool name value. */
  toolName?: string;
  /** Input supplied to the operation. */
  input?: unknown;
}

/** Public API contract for hosted child pending tool lifecycle close reason. */
export type HostedChildPendingToolLifecycleCloseReason =
  | { kind: "ended" }
  | { kind: "aborted" }
  | { kind: "error"; error: unknown };

/** Public API contract for hosted child pending tool lifecycle close log. */
export interface HostedChildPendingToolLifecycleCloseLog {
  /** Reason value. */
  reason: HostedChildPendingToolLifecycleCloseReason["kind"];
  /** Tool call IDs value. */
  toolCallIds: string[];
  /** Error message value. */
  errorMessage: string | null;
}

/** Public API contract for hosted child pending tool lifecycle unknown tool log. */
export interface HostedChildPendingToolLifecycleUnknownToolLog {
  /** Tool call ID value. */
  toolCallId: string;
  /** Phase value. */
  phase: HostedChildPendingToolCallPhase;
  /** Reason value. */
  reason: HostedChildPendingToolLifecycleCloseReason["kind"];
  /** Whether input snapshot. */
  hasInputSnapshot: boolean;
}

/** Public API contract for hosted child pending tool lifecycle logger. */
export interface HostedChildPendingToolLifecycleLogger {
  /** Callback that handles warn incomplete tool lifecycles. */
  warnIncompleteToolLifecycles?: (input: HostedChildPendingToolLifecycleCloseLog) => void;
  /** Callback that handles warn unknown tool identity. */
  warnUnknownToolIdentity?: (input: HostedChildPendingToolLifecycleUnknownToolLog) => void;
}

/** Context for hosted child pending tool lifecycle log. */
export interface HostedChildPendingToolLifecycleLogContext {
  /** Conversation ID value. */
  conversationId?: string;
  /** Parent run ID value. */
  parentRunId?: string;
  /** Description value. */
  description: string;
}

/** Public API contract for hosted child pending tool lifecycle log writer. */
export interface HostedChildPendingToolLifecycleLogWriter {
  /** Writes a warning log entry. */
  warn: (message: string, context: Record<string, unknown>) => void;
}

/** Create hosted child pending tool lifecycle logger. */
export function createHostedChildPendingToolLifecycleLogger(
  context: HostedChildPendingToolLifecycleLogContext,
  writer: HostedChildPendingToolLifecycleLogWriter,
): HostedChildPendingToolLifecycleLogger {
  return {
    warnIncompleteToolLifecycles: (log) => {
      writer.warn("Closing incomplete child fork tool lifecycles", {
        conversationId: context.conversationId,
        runId: context.parentRunId,
        description: context.description,
        reason: log.reason,
        toolCallIds: log.toolCallIds,
        errorMessage: log.errorMessage,
      });
    },
    warnUnknownToolIdentity: (log) => {
      writer.warn("Closing child fork tool lifecycle without recoverable tool identity", {
        conversationId: context.conversationId,
        runId: context.parentRunId,
        description: context.description,
        toolCallId: log.toolCallId,
        phase: log.phase,
        reason: log.reason,
        hasInputSnapshot: log.hasInputSnapshot,
      });
    },
  };
}

/** Input payload for hosted child pending tool lifecycle. */
export interface HostedChildPendingToolLifecycleInput {
  /** Callback that handles append mirror chunk. */
  appendMirrorChunk: (chunk: ChatUiMessageChunk<ChatMessageMetadata>) => Promise<void> | void;
  /** Logger value. */
  logger?: HostedChildPendingToolLifecycleLogger;
}

/** Tracks incomplete tool calls while a child stream is active. */
export interface HostedChildPendingToolLifecycle {
  /** Adds or updates one pending tool call. */
  upsertPendingToolCall(toolCallId: string, state: HostedChildPendingToolCallState): void;
  /** Emits the tool-input start event once for a tool call. */
  emitToolInputStartIfNeeded(toolCallId: string, toolName: string): Promise<void>;
  /** Removes a tool call after its lifecycle completes. */
  deletePendingToolCall(toolCallId: string): void;
  /** Closes every pending tool call with a terminal error event. */
  closePendingToolCalls(reason: HostedChildPendingToolLifecycleCloseReason): Promise<void>;
}

/** Create hosted child pending tool lifecycle. */
export function createHostedChildPendingToolLifecycle(
  input: HostedChildPendingToolLifecycleInput,
): HostedChildPendingToolLifecycle {
  const startedToolCallIds = new Set<string>();
  const pendingToolCalls = new Map<string, HostedChildPendingToolCallState>();

  const emitToolInputStartIfNeeded = async (toolCallId: string, toolName: string) => {
    if (startedToolCallIds.has(toolCallId)) {
      return;
    }

    startedToolCallIds.add(toolCallId);
    await input.appendMirrorChunk({
      type: "tool-input-start",
      toolCallId,
      toolName,
    });
  };

  const upsertPendingToolCall = (toolCallId: string, state: HostedChildPendingToolCallState) => {
    const existing = pendingToolCalls.get(toolCallId);
    pendingToolCalls.set(toolCallId, {
      phase: state.phase,
      toolName: state.toolName ?? existing?.toolName,
      input: state.input ?? existing?.input,
    });
  };

  const closePendingToolCalls = async (reason: HostedChildPendingToolLifecycleCloseReason) => {
    if (pendingToolCalls.size === 0) {
      return;
    }

    const errorMessage = reason.kind === "error"
      ? (reason.error instanceof Error ? reason.error.message : String(reason.error))
      : null;
    const toolCallIds = [...pendingToolCalls.keys()];

    input.logger?.warnIncompleteToolLifecycles?.({
      reason: reason.kind,
      toolCallIds,
      errorMessage,
    });

    for (const [toolCallId, state] of pendingToolCalls) {
      const toolName = state.toolName ?? "unknown";
      if (toolName === "unknown") {
        input.logger?.warnUnknownToolIdentity?.({
          toolCallId,
          phase: state.phase,
          reason: reason.kind,
          hasInputSnapshot: typeof state.input !== "undefined",
        });
      }

      await emitToolInputStartIfNeeded(toolCallId, toolName);

      if (state.phase === "awaiting_result") {
        await input.appendMirrorChunk({
          type: "tool-output-error",
          toolCallId,
          errorText: buildPendingToolOutputErrorText(reason, errorMessage),
        });
        continue;
      }

      await input.appendMirrorChunk({
        type: "tool-input-error",
        toolCallId,
        toolName,
        input: toChildRunToolInputRecord(state.input),
        errorText: buildPendingToolInputErrorText(reason, errorMessage),
      });
    }

    pendingToolCalls.clear();
  };

  return {
    upsertPendingToolCall,
    emitToolInputStartIfNeeded,
    deletePendingToolCall: (toolCallId: string) => {
      pendingToolCalls.delete(toolCallId);
    },
    closePendingToolCalls,
  };
}

function buildPendingToolInputErrorText(
  reason: HostedChildPendingToolLifecycleCloseReason,
  errorMessage: string | null,
): string {
  switch (reason.kind) {
    case "error":
      return `Child fork stream errored before tool input completed: ${errorMessage}`;
    case "aborted":
      return "Child fork stream aborted before tool input completed";
    case "ended":
      return "Child fork stream ended before tool input completed";
  }
}

function buildPendingToolOutputErrorText(
  reason: HostedChildPendingToolLifecycleCloseReason,
  errorMessage: string | null,
): string {
  switch (reason.kind) {
    case "error":
      return `Child fork stream errored before tool result completed: ${errorMessage}`;
    case "aborted":
      return "Child fork stream aborted before tool result completed";
    case "ended":
      return "Child fork stream ended before tool result completed";
  }
}
