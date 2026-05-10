import type { ConversationRunChunkMirror } from "./conversation-run-chunk-mirror.ts";
import {
  type ConversationHostedTerminalAdapter,
  createConversationHostedTerminalAdapter,
} from "./conversation-hosted-terminal.ts";
import type { HostedChatExecutionLifecycleAdapter } from "./hosted-chat-execution-runtime.ts";
import type { HostedLifecycleTerminalState } from "./hosted-lifecycle.ts";
import type { HostedConversationRootRunState } from "./conversation-root-run-lifecycle.ts";
import {
  type AgentTraceAttributes,
  buildAgentRunTraceAttributes,
  buildFinalizedAgentRunTraceAttributes,
} from "./agent-trace-attributes.ts";

export interface HostedAgentRunSpan {
  setAttributes: (attributes: AgentTraceAttributes) => void;
  finish: () => void;
  withContext: <T>(fn: () => T) => T;
}

export interface HostedAgentRunTracer {
  startSpan: (name: string) => HostedAgentRunSpan;
}

export interface HostedAgentRunSpanFinalState {
  status: "completed" | "failed" | "cancelled";
  modelId?: string | null;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
  };
  terminalErrorCode?: string | null;
  terminalErrorMessage?: string | null;
}

export interface HostedAgentRunSpanController {
  withContext: <T>(fn: () => T) => T;
  setAttributes: (attributes: AgentTraceAttributes) => void;
  setMessageId: (messageId: string) => void;
  finalize: (finalState: HostedAgentRunSpanFinalState) => void;
}

export interface CreateHostedAgentRunSpanControllerInput {
  tracer: HostedAgentRunTracer;
  spanName?: string;
  operationName: "chat" | "invoke_agent";
  conversationId?: string;
  projectId: string | null;
  userId: string;
  agentId: string;
  rootRun?: Pick<HostedConversationRootRunState, "runId" | "messageId"> | null;
  upstreamParentConversationId?: string;
  upstreamParentRunId?: string;
  spawnedFromToolCallId?: string;
}

export function createHostedAgentRunSpanController(
  input: CreateHostedAgentRunSpanControllerInput,
): HostedAgentRunSpanController {
  const span = input.tracer.startSpan(input.spanName ?? "agent.run");
  let finalized = false;

  span.setAttributes(
    buildAgentRunTraceAttributes({
      operationName: input.operationName,
      conversationId: input.conversationId,
      projectId: input.projectId,
      userId: input.userId,
      agentId: input.agentId,
      runId: input.rootRun?.runId,
      parentConversationId: input.upstreamParentConversationId,
      parentRunId: input.upstreamParentRunId,
      messageId: input.rootRun?.messageId,
      toolCallId: input.spawnedFromToolCallId,
    }),
  );

  return {
    withContext: (fn) => span.withContext(fn),
    setAttributes: (attributes) => {
      span.setAttributes(attributes);
    },
    setMessageId: (messageId) => {
      span.setAttributes({ "message.id": messageId });
    },
    finalize: (finalState) => {
      if (finalized) {
        return;
      }

      finalized = true;
      span.setAttributes(buildFinalizedAgentRunTraceAttributes(finalState));
      span.finish();
    },
  };
}

export interface HostedRootRunLifecycleRuntimeAdapter extends HostedChatExecutionLifecycleAdapter {
  durableRootRun: HostedConversationRootRunState | null;
  durableRunMirror: ConversationRunChunkMirror | null;
}

export interface CreateHostedRootRunLifecycleRuntimeAdapterInput {
  authToken: string;
  apiUrl: string;
  modelId: string;
  durableRootRun: HostedConversationRootRunState | null;
  durableRunMirror: ConversationRunChunkMirror | null;
  agentRunSpan: Pick<HostedAgentRunSpanController, "finalize">;
  resolveProvider: (modelId: string) => string;
  createTerminalAdapter?: (
    input: Parameters<typeof createConversationHostedTerminalAdapter>[0],
  ) => ConversationHostedTerminalAdapter;
}

function finalizeHostedAgentRunSpan(input: {
  agentRunSpan: Pick<HostedAgentRunSpanController, "finalize">;
  modelId: string;
  terminalState: HostedLifecycleTerminalState;
}): void {
  input.agentRunSpan.finalize({
    status: input.terminalState.status,
    modelId: input.terminalState.metadata?.modelId ?? input.modelId,
    usage: input.terminalState.metadata?.usage,
    terminalErrorCode: input.terminalState.terminalErrorCode,
    terminalErrorMessage: input.terminalState.terminalErrorMessage,
  });
}

export function createHostedRootRunLifecycleRuntimeAdapter(
  input: CreateHostedRootRunLifecycleRuntimeAdapterInput,
): HostedRootRunLifecycleRuntimeAdapter {
  const createTerminal = input.createTerminalAdapter ?? createConversationHostedTerminalAdapter;

  return {
    durableRootRun: input.durableRootRun,
    durableRunMirror: input.durableRunMirror,
    terminal: createTerminal({
      authToken: input.authToken,
      apiUrl: input.apiUrl,
      run: input.durableRootRun
        ? {
          ...input.durableRootRun,
          waitingToolCallId: null,
          waitingToolName: null,
          status: "running",
        }
        : null,
      fallbackModelId: input.modelId,
      resolveProvider: input.resolveProvider,
      onTerminalState: (terminalState) => {
        finalizeHostedAgentRunSpan({
          agentRunSpan: input.agentRunSpan,
          modelId: input.modelId,
          terminalState,
        });
      },
    }),
  };
}
