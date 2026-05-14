import type {
  ChildRunExecutionResult,
  ChildRunExecutionSnapshot,
} from "../child-run/execution-snapshot.ts";
import { buildChildRunResultSummary } from "../child-run/result-summary.ts";
import { type ConversationRunTargets, resolveConversationRunTargets } from "../durable.ts";
import {
  type AgentTraceAttributes,
  buildInvokeAgentTraceAttributes,
} from "../agent-trace-attributes.ts";
import { createConversationChildLifecycleAdapter } from "../conversation/hosted-lifecycle.ts";
import type { InvokeAgentChildRunProgressEvent } from "../invoke-agent-child-runs.ts";
import { bootstrapHostedChildRun } from "./child-bootstrap.ts";
import {
  runHostedChildExecutionLifecycle,
  shouldSkipHostedChildTerminalPersistence,
} from "./child-lifecycle.ts";
import {
  type HostedChildRunIdentifiers,
  HostedChildTerminalStateError,
  type HostedChildTerminalStatus,
} from "./child-status.ts";
import type { HostedChildForkToolInput } from "./child-tool-input.ts";
import { isChildRunAbortError, throwIfChildRunAborted } from "../child-run/execution-support.ts";

export type HostedDurableChildExecutionOptions = {
  durableChildRun?: HostedChildRunIdentifiers;
};

export type HostedDurableChildInvokeResult = {
  ok: boolean;
  status: "completed" | "failed";
  text?: string;
  error?: string;
  summary?: { text: string };
  steps?: number;
  toolCalls?: ChildRunExecutionSnapshot["toolCalls"];
  toolResults?: ChildRunExecutionSnapshot["toolResults"];
  usage?: ChildRunExecutionSnapshot["usage"];
  durationMs?: ChildRunExecutionSnapshot["durationMs"];
  childConversationId?: string | null;
  childRunId?: string | null;
  childMessageId?: string | null;
  sourceTargetKind?: ConversationRunTargets["sourceTargetKind"];
  runtimeTargetKind?: ConversationRunTargets["runtimeTargetKind"];
  terminalErrorCode: string | null;
  terminalErrorMessage: string | null;
};

export type BuildHostedDurableChildInvokeFailureResultInput = {
  terminalErrorCode: string;
  terminalErrorMessage: string;
  targets?: ConversationRunTargets;
  childConversationId?: string | null;
  childRunId?: string | null;
  childMessageId?: string | null;
};

export type HostedDurableChildSuccess<TLocalResult extends ChildRunExecutionResult> = {
  result: TLocalResult;
  snapshot: ChildRunExecutionSnapshot;
  identifiers: HostedChildRunIdentifiers;
  targets: ConversationRunTargets;
};

export type HostedDurableChildTerminalFailure = {
  status: HostedChildTerminalStatus;
  identifiers: HostedChildRunIdentifiers;
  targets: ConversationRunTargets;
  terminalErrorCode: string;
  terminalErrorMessage: string;
};

export type HostedDurableChildSetupFailure = {
  targets: ConversationRunTargets;
  childConversationId: string | null;
  childRunId: string | null;
  childMessageId: string | null;
  terminalErrorCode: string;
  terminalErrorMessage: string;
};

export type HostedDurableChildInvokeTraceInput = Parameters<
  typeof buildInvokeAgentTraceAttributes
>[0];

export type HostedDurableChildInvokeTraceBase = Pick<
  HostedDurableChildInvokeTraceInput,
  "conversationId" | "projectId" | "runId" | "toolCallId" | "childAgentId"
>;

export type HostedDurableChildInvokeTraceOverrides = Partial<
  Omit<HostedDurableChildInvokeTraceInput, keyof HostedDurableChildInvokeTraceBase>
>;

export type HostedDurableChildInvokeTraceRecorder = ReturnType<
  typeof createHostedDurableChildInvokeTraceRecorder
>;

export type HostedLocalChildInvokeTraceRecorder = {
  recordLocalResult<TLocalResult extends ChildRunExecutionResult>(
    result: TLocalResult,
  ): TLocalResult;
  recordLocalFailure(errorMessage: string): void;
};

export type ExecuteHostedLocalChildInvokeInput = {
  forkInput: Pick<HostedChildForkToolInput, "description">;
  abortSignal?: AbortSignal;
  traceRecorder: HostedLocalChildInvokeTraceRecorder;
  execute: () => Promise<ChildRunExecutionResult> | ChildRunExecutionResult;
  isAbortError?: (error: unknown) => boolean;
};

export function buildHostedDurableChildInvokeFailureResult(
  input: BuildHostedDurableChildInvokeFailureResultInput,
): HostedDurableChildInvokeResult {
  return {
    ok: false,
    status: "failed",
    ...(input.childConversationId ? { childConversationId: input.childConversationId } : {}),
    ...(input.childRunId ? { childRunId: input.childRunId } : {}),
    ...(input.childMessageId ? { childMessageId: input.childMessageId } : {}),
    ...(input.targets
      ? {
        sourceTargetKind: input.targets.sourceTargetKind,
        runtimeTargetKind: input.targets.runtimeTargetKind,
      }
      : {}),
    terminalErrorCode: input.terminalErrorCode,
    terminalErrorMessage: input.terminalErrorMessage,
  };
}

export function buildHostedDurableChildInvokeTerminalFailureResult(
  input: HostedDurableChildTerminalFailure,
): HostedDurableChildInvokeResult {
  return buildHostedDurableChildInvokeFailureResult({
    terminalErrorCode: input.terminalErrorCode,
    terminalErrorMessage: input.terminalErrorMessage,
    targets: input.targets,
    childConversationId: input.identifiers.childConversationId,
    childRunId: input.identifiers.childRunId,
    childMessageId: input.identifiers.childMessageId,
  });
}

export function buildHostedDurableChildInvokeSuccessResult<
  TLocalResult extends ChildRunExecutionResult,
>(input: HostedDurableChildSuccess<TLocalResult>): HostedDurableChildInvokeResult {
  const summaryText = input.snapshot.fullResultText ??
    (input.result.success ? input.result.summary.text : input.result.error);

  return {
    ok: input.snapshot.success,
    status: input.snapshot.success ? "completed" : "failed",
    ...(summaryText
      ? {
        text: summaryText,
        summary: buildChildRunResultSummary(summaryText),
      }
      : {}),
    ...(input.snapshot.success ? {} : { error: input.snapshot.error ?? "invoke_agent failed" }),
    steps: input.snapshot.steps,
    toolCalls: input.snapshot.toolCalls,
    toolResults: input.snapshot.toolResults,
    usage: input.snapshot.usage,
    durationMs: input.snapshot.durationMs,
    childConversationId: input.identifiers.childConversationId,
    childRunId: input.identifiers.childRunId,
    childMessageId: input.identifiers.childMessageId,
    sourceTargetKind: input.targets.sourceTargetKind,
    runtimeTargetKind: input.targets.runtimeTargetKind,
    terminalErrorCode: input.snapshot.success ? null : "INVOKE_AGENT_FAILED",
    terminalErrorMessage: input.snapshot.success ? null : input.snapshot.error,
  };
}

export function createHostedDurableChildInvokeTraceRecorder(input: {
  traceBase: HostedDurableChildInvokeTraceBase;
  setTraceAttributes: (attributes: AgentTraceAttributes) => void;
  executionFailedCode: string;
}) {
  function annotate(overrides: HostedDurableChildInvokeTraceOverrides = {}): void {
    input.setTraceAttributes(
      buildInvokeAgentTraceAttributes({
        ...input.traceBase,
        ...overrides,
      }),
    );
  }

  return {
    annotate,
    recordLocalResult<TLocalResult extends ChildRunExecutionResult>(
      result: TLocalResult,
    ): TLocalResult {
      annotate({
        status: result.success ? "completed" : "failed",
        usage: result.usage,
        terminalErrorCode: result.success ? null : input.executionFailedCode,
        terminalErrorMessage: result.success ? null : result.error,
      });

      return result;
    },
    recordLocalFailure(errorMessage: string): void {
      annotate({
        status: "failed",
        terminalErrorCode: input.executionFailedCode,
        terminalErrorMessage: errorMessage,
      });
    },
    recordSetupFailure(
      failure: HostedDurableChildSetupFailure,
    ): HostedDurableChildInvokeResult {
      annotate({
        childConversationId: failure.childConversationId,
        childRunId: failure.childRunId,
        childMessageId: failure.childMessageId,
        sourceTargetKind: failure.targets.sourceTargetKind,
        runtimeTargetKind: failure.targets.runtimeTargetKind,
        status: "failed",
        terminalErrorCode: failure.terminalErrorCode,
        terminalErrorMessage: failure.terminalErrorMessage,
      });

      return buildHostedDurableChildInvokeFailureResult({
        terminalErrorCode: failure.terminalErrorCode,
        terminalErrorMessage: failure.terminalErrorMessage,
        targets: failure.targets,
        childConversationId: failure.childConversationId,
        childRunId: failure.childRunId,
        childMessageId: failure.childMessageId,
      });
    },
    recordTerminalFailure(
      failure: HostedDurableChildTerminalFailure,
    ): HostedDurableChildInvokeResult {
      annotate({
        childConversationId: failure.identifiers.childConversationId,
        childRunId: failure.identifiers.childRunId,
        childMessageId: failure.identifiers.childMessageId,
        sourceTargetKind: failure.targets.sourceTargetKind,
        runtimeTargetKind: failure.targets.runtimeTargetKind,
        status: "failed",
        terminalErrorCode: failure.terminalErrorCode,
        terminalErrorMessage: failure.terminalErrorMessage,
      });

      return buildHostedDurableChildInvokeTerminalFailureResult(failure);
    },
    recordSuccess<TLocalResult extends ChildRunExecutionResult>(
      success: HostedDurableChildSuccess<TLocalResult>,
    ): HostedDurableChildInvokeResult {
      annotate({
        childConversationId: success.identifiers.childConversationId,
        childRunId: success.identifiers.childRunId,
        childMessageId: success.identifiers.childMessageId,
        sourceTargetKind: success.targets.sourceTargetKind,
        runtimeTargetKind: success.targets.runtimeTargetKind,
        status: success.snapshot.success ? "completed" : "failed",
        usage: success.snapshot.usage,
        terminalErrorCode: success.snapshot.success ? null : input.executionFailedCode,
        terminalErrorMessage: success.snapshot.success ? null : success.snapshot.error,
      });

      return buildHostedDurableChildInvokeSuccessResult(success);
    },
  };
}

export async function executeHostedLocalChildInvoke(
  input: ExecuteHostedLocalChildInvokeInput,
): Promise<ChildRunExecutionResult> {
  try {
    const result = await input.execute();
    return input.traceRecorder.recordLocalResult(result);
  } catch (error) {
    const isAbortError = input.isAbortError ?? isChildRunAbortError;
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (isAbortError(error) && (input.abortSignal?.aborted || errorMessage === "Aborted")) {
      throw error;
    }

    input.traceRecorder.recordLocalFailure(errorMessage);

    return {
      success: false,
      description: input.forkInput.description,
      error: errorMessage,
      steps: 0,
      toolCalls: [],
      toolResults: [],
      durationMs: 0,
    };
  }
}

export type HostedDurableChildBootstrapContext = {
  parentConversationId: string;
  parentRunId: string;
  parentMessageId: string;
  targets: ConversationRunTargets;
  resolvedModel: string;
  provider: string;
};

export type HostedDurableChildBootstrapCallbacks = {
  runBootstrap?: <T>(operation: () => Promise<T>) => Promise<T>;
  onBootstrapStart?: (input: HostedDurableChildBootstrapContext) => Promise<void> | void;
  onBootstrapComplete?: (
    input: HostedDurableChildBootstrapContext & { identifiers: HostedChildRunIdentifiers },
  ) => Promise<void> | void;
  onBootstrapError?: (input: {
    error: unknown;
    parentConversationId: string;
    toolCallId: string;
  }) => Promise<void> | void;
};

export type HostedDurableChildRuntimeDependencies = {
  bootstrapChildRun?: typeof bootstrapHostedChildRun;
  createLifecycleAdapter?: typeof createConversationChildLifecycleAdapter;
  runLifecycle?: typeof runHostedChildExecutionLifecycle;
  shouldSkipTerminalPersistence?: typeof shouldSkipHostedChildTerminalPersistence;
};

export type ExecuteHostedDurableChildForkInput<
  TResult,
  TLocalResult extends ChildRunExecutionResult,
> = {
  authToken: string;
  apiUrl: string;
  forkInput: HostedChildForkToolInput;
  executionOptions: {
    toolCallId: string;
    abortSignal?: AbortSignal;
  };
  childAgentId: string;
  runProjectId?: string | null;
  parentConversationId?: string;
  parentRunId?: string;
  parentMessageId?: string;
  getProjectId: () => string | null | undefined;
  getBranchId?: () => string | null | undefined;
  getContextModel?: () => string | undefined;
  defaultModel: string;
  resolveModelId: (model: string) => string;
  resolveProvider: (modelId: string) => string;
  onRequestedProjectId?: (projectId: string) => Promise<void> | void;
  publishParentRunEvents?: (events: InvokeAgentChildRunProgressEvent[]) => Promise<void> | void;
  contextUnavailableMessage: string;
  setupFailedCode: string;
  executionFailedCode: string;
  executeLocal: (
    options?: HostedDurableChildExecutionOptions,
  ) => Promise<TLocalResult> | TLocalResult;
  getExecutionSnapshot: () => ChildRunExecutionSnapshot | null;
  buildContextUnavailableResult: (message: string) => TResult;
  buildSetupFailureResult: (failure: HostedDurableChildSetupFailure) => TResult;
  buildTerminalFailureResult: (failure: HostedDurableChildTerminalFailure) => TResult;
  buildSuccessResult: (success: HostedDurableChildSuccess<TLocalResult>) => TResult;
  onLifecycleError?: (error: unknown) => Promise<void> | void;
  onLifecycleFinalized?: (input: {
    identifiers: HostedChildRunIdentifiers;
    status: "completed";
  }) => Promise<void> | void;
  bootstrap?: HostedDurableChildBootstrapCallbacks;
  runtime?: HostedDurableChildRuntimeDependencies;
};

function getBranchId(input: {
  getBranchId?: () => string | null | undefined;
}): string | null | undefined {
  return input.getBranchId?.();
}

function resolveContextModel(input: {
  forkInput: HostedChildForkToolInput;
  getContextModel?: () => string | undefined;
  defaultModel: string;
}): string {
  return input.forkInput.model || input.getContextModel?.() || input.defaultModel;
}

async function defaultRunBootstrap<T>(operation: () => Promise<T>): Promise<T> {
  return operation();
}

async function prepareHostedDurableChildBootstrapContext<
  TResult,
  TLocalResult extends ChildRunExecutionResult,
>(
  input: ExecuteHostedDurableChildForkInput<TResult, TLocalResult> & {
    parentConversationId: string;
    parentRunId: string;
    parentMessageId: string;
  },
): Promise<HostedDurableChildBootstrapContext> {
  if (input.forkInput.project_id) {
    await input.onRequestedProjectId?.(input.forkInput.project_id);
  }

  const targets = resolveConversationRunTargets({
    projectId: input.getProjectId() ?? null,
    branchId: getBranchId(input) ?? null,
  });
  const resolvedModel = input.resolveModelId(resolveContextModel(input));

  return {
    parentConversationId: input.parentConversationId,
    parentRunId: input.parentRunId,
    parentMessageId: input.parentMessageId,
    targets,
    resolvedModel,
    provider: input.resolveProvider(resolvedModel),
  };
}

async function bootstrapHostedDurableChildFork<
  TResult,
  TLocalResult extends ChildRunExecutionResult,
>(
  input: ExecuteHostedDurableChildForkInput<TResult, TLocalResult> & {
    bootstrapContext: HostedDurableChildBootstrapContext;
  },
): Promise<HostedChildRunIdentifiers> {
  const runBootstrap = input.bootstrap?.runBootstrap ?? defaultRunBootstrap;

  return runBootstrap(async () => {
    await input.bootstrap?.onBootstrapStart?.(input.bootstrapContext);

    const bootstrapChildRun = input.runtime?.bootstrapChildRun ?? bootstrapHostedChildRun;
    const run = await bootstrapChildRun({
      authToken: input.authToken,
      apiUrl: input.apiUrl,
      ensureProjectId: input.getProjectId() ?? undefined,
      runProjectId: input.runProjectId !== undefined ? input.runProjectId : undefined,
      parentConversationId: input.bootstrapContext.parentConversationId,
      parentRunId: input.bootstrapContext.parentRunId,
      parentMessageId: input.bootstrapContext.parentMessageId,
      spawnedFromToolCallId: input.executionOptions.toolCallId,
      description: input.forkInput.description,
      prompt: input.forkInput.prompt,
      agentId: input.childAgentId,
      branchId: getBranchId(input),
    });
    const identifiers: HostedChildRunIdentifiers = {
      childConversationId: run.childConversationId,
      childRunId: run.childRunId,
      childMessageId: run.childMessageId,
      latestEventId: run.latestEventId,
      latestExternalEventSequence: run.latestExternalEventSequence,
    };

    await input.bootstrap?.onBootstrapComplete?.({
      ...input.bootstrapContext,
      identifiers,
    });

    return identifiers;
  });
}

async function executeHostedDurableChildLifecycle<
  TResult,
  TLocalResult extends ChildRunExecutionResult,
>(
  input: ExecuteHostedDurableChildForkInput<TResult, TLocalResult> & {
    bootstrapContext: HostedDurableChildBootstrapContext;
    identifiers: HostedChildRunIdentifiers;
  },
): Promise<TResult> {
  const { bootstrapContext, identifiers } = input;
  const { targets } = bootstrapContext;
  const createLifecycleAdapter = input.runtime?.createLifecycleAdapter ??
    createConversationChildLifecycleAdapter;
  const lifecycleAdapter = createLifecycleAdapter({
    authToken: input.authToken,
    apiUrl: input.apiUrl,
    parentConversationId: bootstrapContext.parentConversationId,
    parentRunId: bootstrapContext.parentRunId,
    projectId: input.getProjectId(),
    publishParentRunEvents: input.publishParentRunEvents,
    progress: {
      toolCallId: input.executionOptions.toolCallId,
      childAgentId: input.childAgentId,
      childConversationId: identifiers.childConversationId,
      childRunId: identifiers.childRunId,
      childMessageId: identifiers.childMessageId,
      description: input.forkInput.description,
      sourceTargetKind: targets.sourceTargetKind as any,
      runtimeTargetKind: targets.runtimeTargetKind as any,
      targetBranchId: targets.targetBranchId,
    },
    model: bootstrapContext.resolvedModel,
    provider: bootstrapContext.provider,
  });

  const runLifecycle = input.runtime?.runLifecycle ?? runHostedChildExecutionLifecycle;
  const skipTerminalPersistence = input.runtime?.shouldSkipTerminalPersistence ??
    shouldSkipHostedChildTerminalPersistence;
  const lifecycleResult = await runLifecycle({
    adapter: lifecycleAdapter,
    executionFailedCode: input.executionFailedCode,
    abortSignal: input.executionOptions.abortSignal,
    execute: () =>
      input.executeLocal({
        durableChildRun: identifiers,
      }),
    getExecutionSnapshot: input.getExecutionSnapshot,
    onLifecycleError: input.onLifecycleError,
    skipTerminalPersistence,
  });

  if (lifecycleResult.status !== "completed") {
    if (
      lifecycleResult.status === "cancelled" &&
      !(lifecycleResult.error instanceof HostedChildTerminalStateError)
    ) {
      throw lifecycleResult.error;
    }

    return input.buildTerminalFailureResult({
      status: lifecycleResult.terminalState.status as any,
      identifiers,
      targets,
      terminalErrorCode: lifecycleResult.terminalState.terminalErrorCode ??
        input.executionFailedCode,
      terminalErrorMessage: lifecycleResult.terminalState.terminalErrorMessage ?? "Unknown error",
    });
  }

  await input.onLifecycleFinalized?.({
    identifiers,
    status: lifecycleResult.status,
  });

  return input.buildSuccessResult({
    result: lifecycleResult.result,
    snapshot: lifecycleResult.snapshot,
    identifiers,
    targets,
  });
}

export async function executeHostedDurableChildFork<
  TResult,
  TLocalResult extends ChildRunExecutionResult,
>(
  input: ExecuteHostedDurableChildForkInput<TResult, TLocalResult>,
): Promise<TResult> {
  throwIfChildRunAborted(input.executionOptions.abortSignal);

  if (!input.parentConversationId || !input.parentRunId || !input.parentMessageId) {
    return input.buildContextUnavailableResult(input.contextUnavailableMessage);
  }

  const bootstrapContext = await prepareHostedDurableChildBootstrapContext({
    ...input,
    parentConversationId: input.parentConversationId,
    parentRunId: input.parentRunId,
    parentMessageId: input.parentMessageId,
  });
  const { targets } = bootstrapContext;
  let identifiers: HostedChildRunIdentifiers;

  try {
    identifiers = await bootstrapHostedDurableChildFork({
      ...input,
      bootstrapContext,
    });
  } catch (error) {
    await input.bootstrap?.onBootstrapError?.({
      error,
      parentConversationId: bootstrapContext.parentConversationId,
      toolCallId: input.executionOptions.toolCallId,
    });

    return input.buildSetupFailureResult({
      targets,
      childConversationId: null,
      childRunId: null,
      childMessageId: null,
      terminalErrorCode: input.setupFailedCode,
      terminalErrorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  return executeHostedDurableChildLifecycle({
    ...input,
    bootstrapContext,
    identifiers,
  });
}
