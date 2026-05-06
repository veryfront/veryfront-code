import {
  type ConversationAgentRunUsage,
  type ConversationRunProjection,
  finalizeConversationAgentRun,
} from "./durable.ts";
import type { HostedLifecycleTerminalState } from "./hosted-lifecycle.ts";

export interface ConversationHostedTerminalStateInput {
  status: HostedLifecycleTerminalState["status"];
  metadata?: HostedLifecycleTerminalState["metadata"];
  terminalErrorCode?: string | null;
  terminalErrorMessage?: string | null;
}

export const CONVERSATION_HOSTED_STREAM_ERROR_TERMINAL_ERROR_CODE = "STREAM_ERROR";
export const CONVERSATION_HOSTED_ABORTED_TERMINAL_ERROR_CODE = "ABORTED";
export const CONVERSATION_HOSTED_INCOMPLETE_TOOL_CALLS_TERMINAL_ERROR_CODE =
  "INCOMPLETE_TOOL_CALLS";

const DEFAULT_CONVERSATION_HOSTED_ABORTED_TERMINAL_ERROR_MESSAGE = "Chat stream aborted";
const DEFAULT_CONVERSATION_HOSTED_INCOMPLETE_TOOL_CALLS_TERMINAL_ERROR_MESSAGE =
  "Assistant completed before tool execution completed";

export interface ResolveConversationHostedTerminalStateInput {
  isAborted: boolean;
  hasIncompleteToolParts: boolean;
  abortedTerminalErrorMessage?: string;
  incompleteToolCallsTerminalErrorMessage?: string;
}

export type ConversationHostedTerminalStateResolution = Pick<
  ConversationHostedTerminalStateInput,
  "status" | "terminalErrorCode" | "terminalErrorMessage"
>;

export function resolveConversationHostedTerminalState(
  input: ResolveConversationHostedTerminalStateInput,
): ConversationHostedTerminalStateResolution {
  if (input.isAborted) {
    return {
      status: "cancelled",
      terminalErrorCode: CONVERSATION_HOSTED_ABORTED_TERMINAL_ERROR_CODE,
      terminalErrorMessage: input.abortedTerminalErrorMessage ??
        DEFAULT_CONVERSATION_HOSTED_ABORTED_TERMINAL_ERROR_MESSAGE,
    };
  }

  if (input.hasIncompleteToolParts) {
    return {
      status: "failed",
      terminalErrorCode: CONVERSATION_HOSTED_INCOMPLETE_TOOL_CALLS_TERMINAL_ERROR_CODE,
      terminalErrorMessage: input.incompleteToolCallsTerminalErrorMessage ??
        DEFAULT_CONVERSATION_HOSTED_INCOMPLETE_TOOL_CALLS_TERMINAL_ERROR_MESSAGE,
    };
  }

  return { status: "completed" };
}

export function resolveConversationHostedStreamErrorState(
  error: unknown,
): ConversationHostedTerminalStateResolution {
  return {
    status: "failed",
    terminalErrorCode: CONVERSATION_HOSTED_STREAM_ERROR_TERMINAL_ERROR_CODE,
    terminalErrorMessage: error instanceof Error ? error.message : String(error),
  };
}

export interface ConversationHostedTerminalRuntimeAdapter {
  terminal: Pick<
    ConversationHostedTerminalAdapter,
    "toTerminalState" | "finalizeRun" | "cancelRun" | "onTerminalState"
  >;
}

export async function dispatchConversationHostedTerminalState(
  adapter: ConversationHostedTerminalRuntimeAdapter,
  state: ConversationHostedTerminalStateInput,
): Promise<HostedLifecycleTerminalState> {
  const terminalState = adapter.terminal.toTerminalState(state);
  if (terminalState.status === "cancelled") {
    await adapter.terminal.cancelRun(terminalState);
  } else {
    await adapter.terminal.finalizeRun(terminalState);
  }
  await adapter.terminal.onTerminalState(terminalState);
  return terminalState;
}

export async function dispatchConversationHostedStreamErrorState(
  adapter: ConversationHostedTerminalRuntimeAdapter,
  error: unknown,
): Promise<HostedLifecycleTerminalState> {
  return dispatchConversationHostedTerminalState(
    adapter,
    resolveConversationHostedStreamErrorState(error),
  );
}

export interface CreateConversationHostedTerminalAdapterOptions {
  authToken: string;
  apiUrl: string;
  run: ConversationRunProjection | null;
  fallbackModelId: string;
  resolveProvider: (modelId: string) => string;
  onTerminalState?: (terminalState: HostedLifecycleTerminalState) => Promise<void> | void;
}

export interface ConversationHostedTerminalAdapter {
  toTerminalState: (state: ConversationHostedTerminalStateInput) => HostedLifecycleTerminalState;
  finalizeRun: (terminalState: HostedLifecycleTerminalState) => Promise<void>;
  cancelRun: (terminalState: HostedLifecycleTerminalState) => Promise<void>;
  onTerminalState: (terminalState: HostedLifecycleTerminalState) => Promise<void>;
  dispatch: (state: ConversationHostedTerminalStateInput) => Promise<HostedLifecycleTerminalState>;
}

type HostedLifecycleUsage = NonNullable<HostedLifecycleTerminalState["metadata"]>["usage"];

function buildConversationHostedLifecycleUsage(
  usage: HostedLifecycleUsage | undefined,
): HostedLifecycleUsage | undefined {
  if (!usage) {
    return undefined;
  }

  return {
    ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
    ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
    ...(usage.cachedInputTokens !== undefined
      ? { cachedInputTokens: usage.cachedInputTokens }
      : {}),
  };
}

function buildConversationAgentRunUsage(
  usage: HostedLifecycleUsage | undefined,
): ConversationAgentRunUsage | undefined {
  if (!usage) {
    return undefined;
  }

  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

export function toConversationHostedTerminalState(input: {
  fallbackModelId: string;
  state: ConversationHostedTerminalStateInput;
}): HostedLifecycleTerminalState {
  const modelId = input.state.metadata?.modelId ?? input.fallbackModelId;
  const usage = buildConversationHostedLifecycleUsage(input.state.metadata?.usage);

  return {
    status: input.state.status,
    ...(modelId || usage
      ? {
        metadata: {
          ...(modelId ? { modelId } : {}),
          ...(usage ? { usage } : {}),
        },
      }
      : {}),
    ...(input.state.terminalErrorCode !== undefined
      ? { terminalErrorCode: input.state.terminalErrorCode }
      : {}),
    ...(input.state.terminalErrorMessage !== undefined
      ? { terminalErrorMessage: input.state.terminalErrorMessage }
      : {}),
  };
}

export function createConversationHostedTerminalAdapter(
  options: CreateConversationHostedTerminalAdapterOptions,
): ConversationHostedTerminalAdapter {
  let durableRunFinalized = false;

  const finalizeDurableRun = async (
    terminalState: HostedLifecycleTerminalState,
    status: HostedLifecycleTerminalState["status"],
  ): Promise<void> => {
    if (!options.run || durableRunFinalized) {
      return;
    }

    durableRunFinalized = true;
    const modelId = terminalState.metadata?.modelId ?? options.fallbackModelId;

    await finalizeConversationAgentRun({
      authToken: options.authToken,
      apiUrl: options.apiUrl,
      conversationId: options.run.conversationId,
      runId: options.run.runId,
      status,
      model: modelId,
      provider: options.resolveProvider(modelId),
      usage: buildConversationAgentRunUsage(terminalState.metadata?.usage),
      terminalErrorCode: terminalState.terminalErrorCode,
      terminalErrorMessage: terminalState.terminalErrorMessage,
    });
  };

  return {
    toTerminalState: (state) =>
      toConversationHostedTerminalState({
        fallbackModelId: options.fallbackModelId,
        state,
      }),
    finalizeRun: (terminalState) => finalizeDurableRun(terminalState, terminalState.status),
    cancelRun: (terminalState) => finalizeDurableRun(terminalState, "cancelled"),
    onTerminalState: async (terminalState) => {
      await options.onTerminalState?.(terminalState);
    },
    dispatch: async (state) => {
      const terminalState = toConversationHostedTerminalState({
        fallbackModelId: options.fallbackModelId,
        state,
      });

      if (terminalState.status === "cancelled") {
        await finalizeDurableRun(terminalState, "cancelled");
      } else {
        await finalizeDurableRun(terminalState, terminalState.status);
      }
      await options.onTerminalState?.(terminalState);
      return terminalState;
    },
  };
}
