import type { ChatMessageMetadata, ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";
import {
  createHostedChildMirrorContext,
  type HostedChildChunkMirror,
  type HostedChildMirrorContext,
} from "./hosted-child-mirror.ts";
import {
  createHostedChildPendingToolLifecycle,
  createHostedChildPendingToolLifecycleLogger,
  type HostedChildPendingToolLifecycleLogContext,
  type HostedChildPendingToolLifecycleLogWriter,
} from "./hosted-child-pending-tool-lifecycle.ts";
import type { HostedChildForkPendingToolLifecycle } from "./hosted-child-fork-stream-execution.ts";

export interface HostedChildForkToolCallSnapshot {
  toolName: string;
  toolCallId: string;
  input?: unknown;
}

export interface HostedChildForkToolResultSnapshot {
  toolName: string;
  toolCallId: string;
  input: unknown;
  output: unknown;
}

export interface HostedChildForkStreamState {
  finalText: string;
}

export interface HostedChildForkStreamMirrorContext {
  durableRunMirror: boolean;
  durableMessageId: string | null;
  durableReasoningMessageId: string | null;
  durableMirrorState: HostedChildMirrorContext["state"];
  appendDurableMirrorChunk: (chunk: ChatUiMessageChunk<ChatMessageMetadata>) => Promise<void>;
  closeDurableMirrorReasoning: () => Promise<void>;
  closeDurableMirrorText: () => Promise<void>;
  markDurableStepStarted: () => void;
  hasStartedStep: () => boolean;
  hasEmittedProgress: () => boolean;
}

export interface HostedChildForkRunContext {
  mirrorContext: HostedChildMirrorContext;
  streamMirrorContext: HostedChildForkStreamMirrorContext;
  pendingToolLifecycle: HostedChildForkPendingToolLifecycle;
  toolCalls: HostedChildForkToolCallSnapshot[];
  toolResults: HostedChildForkToolResultSnapshot[];
  streamState: HostedChildForkStreamState;
}

export interface HostedChildForkRunContextInput {
  mirror: HostedChildChunkMirror | null;
  messageId?: string | null;
  reasoningMessageId?: string | null;
  pendingToolLogContext: HostedChildPendingToolLifecycleLogContext;
  pendingToolLogWriter?: HostedChildPendingToolLifecycleLogWriter;
}

export function createHostedChildForkRunContext(
  input: HostedChildForkRunContextInput,
): HostedChildForkRunContext {
  const mirrorContext = createHostedChildMirrorContext({
    mirror: input.mirror,
    messageId: input.messageId,
    reasoningMessageId: input.reasoningMessageId,
  });
  const streamMirrorContext: HostedChildForkStreamMirrorContext = {
    durableRunMirror: Boolean(mirrorContext.mirror),
    durableMessageId: mirrorContext.messageId,
    durableReasoningMessageId: mirrorContext.reasoningMessageId,
    durableMirrorState: mirrorContext.state,
    appendDurableMirrorChunk: mirrorContext.appendChunk,
    closeDurableMirrorReasoning: mirrorContext.closeReasoningSegment,
    closeDurableMirrorText: mirrorContext.closeTextSegment,
    markDurableStepStarted: mirrorContext.markStepStarted,
    hasStartedStep: mirrorContext.hasStartedStep,
    hasEmittedProgress: mirrorContext.hasEmittedProgress,
  };

  return {
    mirrorContext,
    streamMirrorContext,
    pendingToolLifecycle: createHostedChildPendingToolLifecycle({
      appendMirrorChunk: streamMirrorContext.appendDurableMirrorChunk,
      logger: input.pendingToolLogWriter
        ? createHostedChildPendingToolLifecycleLogger(
          input.pendingToolLogContext,
          input.pendingToolLogWriter,
        )
        : undefined,
    }),
    toolCalls: [],
    toolResults: [],
    streamState: { finalText: "" },
  };
}
