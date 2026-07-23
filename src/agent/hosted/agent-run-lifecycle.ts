import type { ConversationRunChunkMirror } from "../conversation/run-chunk-mirror.ts";
import {
  type ConversationHostedTerminalAdapter,
  createConversationHostedTerminalAdapter,
} from "../conversation/hosted-terminal.ts";
import type { HostedChatExecutionLifecycleAdapter } from "./chat-execution-lifecycle-types.ts";
import type { HostedLifecycleTerminalState } from "./lifecycle.ts";
import type { HostedConversationRootRunState } from "../conversation/root-run-lifecycle.ts";
import {
  type AgentTraceAttributes,
  buildAgentRunTraceAttributes,
  buildFinalizedAgentRunTraceAttributes,
} from "./trace-attributes.ts";

/** Public API contract for hosted agent run span. */
export interface HostedAgentRunSpan {
  /** Callback that handles set attributes. */
  setAttributes: (attributes: AgentTraceAttributes) => void;
  /** Callback that handles finish. */
  finish: () => void;
  /** Callback that handles with context. */
  withContext: <T>(fn: () => T) => T;
}

/** Public API contract for hosted agent run tracer. */
export interface HostedAgentRunTracer {
  /** Callback that handles start span. */
  startSpan: (name: string) => HostedAgentRunSpan;
}

/** State for hosted agent run span final. */
export interface HostedAgentRunSpanFinalState {
  /** Status. */
  status: "completed" | "failed" | "cancelled";
  /** Model ID value. */
  modelId?: string | null;
  /** Usage value. */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cachedInputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    reasoningTokens?: number;
  };
  /** Terminal error code value. */
  terminalErrorCode?: string | null;
  /** Terminal error message value. */
  terminalErrorMessage?: string | null;
}

/** Public API contract for hosted agent run span controller. */
export interface HostedAgentRunSpanController {
  /** Callback that handles with context. */
  withContext: <T>(fn: () => T) => T;
  /** Callback that handles set attributes. */
  setAttributes: (attributes: AgentTraceAttributes) => void;
  /** Callback that handles set message ID. */
  setMessageId: (messageId: string) => void;
  /** Finalizes the associated lifecycle. */
  finalize: (finalState: HostedAgentRunSpanFinalState) => void;
}

/** Input payload for create hosted agent run span controller. */
export interface CreateHostedAgentRunSpanControllerInput {
  /** Tracer value. */
  tracer: HostedAgentRunTracer;
  /** Span name value. */
  spanName?: string;
  /** Operation name value. */
  operationName: "chat" | "invoke_agent";
  /** Conversation ID value. */
  conversationId?: string;
  /** Project ID value. */
  projectId: string | null;
  /** User ID value. */
  userId: string;
  /** Agent ID value. */
  agentId: string;
  /** Agent name value. */
  agentName?: string;
  /** Model ID value. */
  modelId?: string;
  /** Root run value. */
  rootRun?: Pick<HostedConversationRootRunState, "runId" | "messageId"> | null;
  /** Upstream parent conversation ID value. */
  upstreamParentConversationId?: string;
  /** Upstream parent run ID value. */
  upstreamParentRunId?: string;
  /** Spawned from tool call ID value. */
  spawnedFromToolCallId?: string;
  /** Trace attributes value. */
  traceAttributes?: AgentTraceAttributes;
}

/** Create hosted agent run span controller. */
export function createHostedAgentRunSpanController(
  input: CreateHostedAgentRunSpanControllerInput,
): HostedAgentRunSpanController {
  const spanName = input.spanName ??
    (input.operationName === "invoke_agent"
      ? `invoke_agent ${input.agentName ?? input.agentId}`
      : "agent.run");
  const span = input.tracer.startSpan(spanName);
  let finalized = false;

  span.setAttributes(
    buildAgentRunTraceAttributes({
      operationName: input.operationName,
      conversationId: input.conversationId,
      projectId: input.projectId,
      userId: input.userId,
      agentId: input.agentId,
      agentName: input.agentName,
      modelId: input.modelId,
      runId: input.rootRun?.runId,
      parentConversationId: input.upstreamParentConversationId,
      parentRunId: input.upstreamParentRunId,
      messageId: input.rootRun?.messageId,
      toolCallId: input.spawnedFromToolCallId,
      scheduleId: typeof input.traceAttributes?.["schedule.id"] === "string"
        ? input.traceAttributes["schedule.id"]
        : null,
      scheduleName: typeof input.traceAttributes?.["schedule.name"] === "string"
        ? input.traceAttributes["schedule.name"]
        : null,
    }),
  );
  if (input.traceAttributes) {
    span.setAttributes(input.traceAttributes);
  }

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

/** Public API contract for hosted root run lifecycle runtime adapter. */
export interface HostedRootRunLifecycleRuntimeAdapter extends HostedChatExecutionLifecycleAdapter {
  /** Durable root run value. */
  durableRootRun: HostedConversationRootRunState | null;
  /** Durable run mirror value. */
  durableRunMirror: ConversationRunChunkMirror | null;
}

/** Input payload for create hosted root run lifecycle runtime adapter. */
export interface CreateHostedRootRunLifecycleRuntimeAdapterInput {
  /** Bearer token used for authenticated API requests. */
  authToken: string;
  /** Base URL for Veryfront API requests. */
  apiUrl: string;
  /** Model ID value. */
  modelId: string;
  /** Durable root run value. */
  durableRootRun: HostedConversationRootRunState | null;
  /** Durable run mirror value. */
  durableRunMirror: ConversationRunChunkMirror | null;
  /** Agent run span value. */
  agentRunSpan: Pick<HostedAgentRunSpanController, "finalize">;
  /** Callback that handles resolve provider. */
  resolveProvider: (modelId: string) => string;
  /** Create terminal adapter value. */
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

/** Create hosted root run lifecycle runtime adapter. */
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
