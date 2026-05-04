import type { ChatMessageMetadata, ChatUiMessageChunk } from "../chat/protocol.ts";
import { toChildRunToolInputRecord } from "./child-run-execution-support.ts";

export type HostedChildPendingToolCallPhase = "input_streaming" | "awaiting_result";

export interface HostedChildPendingToolCallState {
  phase: HostedChildPendingToolCallPhase;
  toolName?: string;
  input?: unknown;
}

export type HostedChildPendingToolLifecycleCloseReason =
  | { kind: "ended" }
  | { kind: "aborted" }
  | { kind: "error"; error: unknown };

export interface HostedChildPendingToolLifecycleCloseLog {
  reason: HostedChildPendingToolLifecycleCloseReason["kind"];
  toolCallIds: string[];
  errorMessage: string | null;
}

export interface HostedChildPendingToolLifecycleUnknownToolLog {
  toolCallId: string;
  phase: HostedChildPendingToolCallPhase;
  reason: HostedChildPendingToolLifecycleCloseReason["kind"];
  hasInputSnapshot: boolean;
}

export interface HostedChildPendingToolLifecycleLogger {
  warnIncompleteToolLifecycles?: (input: HostedChildPendingToolLifecycleCloseLog) => void;
  warnUnknownToolIdentity?: (input: HostedChildPendingToolLifecycleUnknownToolLog) => void;
}

export interface HostedChildPendingToolLifecycleInput {
  appendMirrorChunk: (chunk: ChatUiMessageChunk<ChatMessageMetadata>) => Promise<void> | void;
  logger?: HostedChildPendingToolLifecycleLogger;
}

export function createHostedChildPendingToolLifecycle(input: HostedChildPendingToolLifecycleInput) {
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
