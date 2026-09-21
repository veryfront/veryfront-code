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
  type AgentTraceUsage,
  buildAgentRunTraceAttributes,
  buildFinalizedAgentRunTraceAttributes,
} from "./trace-attributes.ts";

/** Public API contract for hosted agent run span. */
export interface HostedAgentRunSpan {
  setAttributes: (attributes: AgentTraceAttributes) => void;
  finish: () => void;
  withContext: <T>(fn: () => T) => T;
}

/** Public API contract for hosted agent run tracer. */
export interface HostedAgentRunTracer {
  startSpan: (name: string) => HostedAgentRunSpan;
}

/** State for hosted agent run span final. */
export interface HostedAgentRunSpanFinalState {
  status: "completed" | "failed" | "cancelled";
  modelId?: string | null;
  /**
   * Tokens *and* cost.
   *
   * This span is **not** named `agent.run` in production. No caller passes
   * `operationName: "chat"` and none supplies `spanName`, so the name resolved below
   * is always `invoke_agent <agentName>`; hosted runs were never part of a
   * `{ name = "agent.run" }` spend sum and were never diluting one.
   *
   * What they were doing is reporting token counts with no spend at all, on every
   * status, so hosted spend could not be read off a trace by any query. That is what
   * this shape fixes. The span keeps its `invoke_agent` name deliberately: the same
   * controller also spans delegated sub-agent runs, so renaming it would make a
   * name-based spend sum double count a parent and its children.
   */
  usage?: AgentTraceUsage;
  terminalErrorCode?: string | null;
  terminalErrorMessage?: string | null;
}

/** Public API contract for hosted agent run span controller. */
export interface HostedAgentRunSpanController {
  withContext: <T>(fn: () => T) => T;
  setAttributes: (attributes: AgentTraceAttributes) => void;
  setMessageId: (messageId: string) => void;
  finalize: (finalState: HostedAgentRunSpanFinalState) => void;
}

/** Input payload for create hosted agent run span controller. */
export interface CreateHostedAgentRunSpanControllerInput {
  tracer: HostedAgentRunTracer;
  spanName?: string;
  operationName: "chat" | "invoke_agent";
  conversationId?: string;
  projectId: string | null;
  userId: string;
  agentId: string;
  agentName?: string;
  modelId?: string;
  rootRun?: Pick<HostedConversationRootRunState, "runId" | "messageId"> | null;
  upstreamParentConversationId?: string;
  upstreamParentRunId?: string;
  spawnedFromToolCallId?: string;
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
  durableRootRun: HostedConversationRootRunState | null;
  durableRunMirror: ConversationRunChunkMirror | null;
}

/** Input payload for create hosted root run lifecycle runtime adapter. */
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

/**
 * Flattens hosted terminal metadata into the span's usage shape.
 *
 * Token counts arrive nested under `metadata.usage`; the billing fields sit beside it
 * at the top level (ChatMessageMetadata's layout). The span wants them in one object,
 * and an all-absent result stays `undefined` so a run with nothing to report emits no
 * usage attributes rather than a row of zeroes.
 */
const HOSTED_RUN_BILLING_USAGE_KEYS = [
  "billableInputTokens",
  "billableOutputTokens",
  "costUsd",
  "providerInputCostUsd",
  "providerOutputCostUsd",
  "providerCostUsd",
  "veryfrontInputChargeUsd",
  "veryfrontOutputChargeUsd",
  "veryfrontChargeUsd",
  "veryfrontBilledUsd",
  "costCredits",
  "costSource",
  "billingMode",
  "usageCaptureStatus",
] as const satisfies readonly (
  & keyof NonNullable<HostedLifecycleTerminalState["metadata"]>
  & keyof AgentTraceUsage
)[];

function buildHostedAgentRunSpanUsage(
  metadata: HostedLifecycleTerminalState["metadata"],
): AgentTraceUsage | undefined {
  if (!metadata) {
    return undefined;
  }

  const usage: Record<string, unknown> = { ...metadata.usage };
  for (const key of HOSTED_RUN_BILLING_USAGE_KEYS) {
    const value = metadata[key];
    if (value !== undefined) {
      usage[key] = value;
    }
  }

  return Object.keys(usage).length > 0 ? usage as AgentTraceUsage : undefined;
}

function finalizeHostedAgentRunSpan(input: {
  agentRunSpan: Pick<HostedAgentRunSpanController, "finalize">;
  modelId: string;
  terminalState: HostedLifecycleTerminalState;
}): void {
  input.agentRunSpan.finalize({
    status: input.terminalState.status,
    modelId: input.terminalState.metadata?.modelId ?? input.modelId,
    usage: buildHostedAgentRunSpanUsage(input.terminalState.metadata),
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
          streamProtocolVersion: 1,
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
