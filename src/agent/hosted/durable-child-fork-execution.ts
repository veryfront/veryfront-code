import type {
  ChildRunExecutionResult,
  ChildRunExecutionSnapshot,
} from "../child-run/execution-snapshot.ts";
import { parseProviderError } from "../../chat/provider-errors.ts";
import {
  buildChildRunResultSummary,
  type ChildRunResultMode,
  type ChildRunResultSummary,
} from "../child-run/result-summary.ts";
import {
  type ConversationRunTargets,
  resolveConversationRunTargets,
} from "../conversation/durable.ts";
import { type AgentTraceAttributes, buildInvokeAgentTraceAttributes } from "./trace-attributes.ts";
import { createConversationChildLifecycleAdapter } from "../conversation/hosted-lifecycle.ts";
import type { InvokeAgentChildRunProgressEvent } from "../child-run/invoke-agent-child-runs.ts";
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
import {
  buildHostedChildForkEffectivePrompt,
  type HostedChildForkToolInput,
  withHostedChildInvocationContext,
} from "./child-tool-input.ts";
import { isChildRunAbortError, throwIfChildRunAborted } from "../child-run/execution-support.ts";

/** Options accepted by hosted durable child execution. */
export type HostedDurableChildExecutionOptions = {
  durableChildRun?: HostedChildRunIdentifiers;
};

/** Result returned from hosted durable child invoke. */
export type HostedDurableChildInvokeResult = {
  ok: boolean;
  status: "completed" | "failed";
  text?: string;
  error?: string;
  summary?: ChildRunResultSummary;
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

/** Input payload for build hosted durable child invoke failure result. */
export type BuildHostedDurableChildInvokeFailureResultInput = {
  terminalErrorCode: string;
  terminalErrorMessage: string;
  targets?: ConversationRunTargets;
  childConversationId?: string | null;
  childRunId?: string | null;
  childMessageId?: string | null;
};

/** Public API contract for hosted durable child success. */
export type HostedDurableChildSuccess<TLocalResult extends ChildRunExecutionResult> = {
  result: TLocalResult;
  snapshot: ChildRunExecutionSnapshot;
  identifiers: HostedChildRunIdentifiers;
  targets: ConversationRunTargets;
};

/** Options accepted when building hosted durable child invoke success results. */
export type HostedDurableChildInvokeSuccessResultOptions = {
  resultMode?: ChildRunResultMode;
};

/** Public API contract for hosted durable child terminal failure. */
export type HostedDurableChildTerminalFailure = {
  status: HostedChildTerminalStatus;
  identifiers: HostedChildRunIdentifiers;
  targets: ConversationRunTargets;
  terminalErrorCode: string;
  terminalErrorMessage: string;
};

/** Public API contract for hosted durable child setup failure. */
export type HostedDurableChildSetupFailure = {
  targets: ConversationRunTargets;
  childConversationId: string | null;
  childRunId: string | null;
  childMessageId: string | null;
  terminalErrorCode: string;
  terminalErrorMessage: string;
};

/** Input payload for hosted durable child invoke trace. */
export type HostedDurableChildInvokeTraceInput = Parameters<
  typeof buildInvokeAgentTraceAttributes
>[0];

/** Public API contract for hosted durable child invoke trace base. */
export type HostedDurableChildInvokeTraceBase = Pick<
  HostedDurableChildInvokeTraceInput,
  "conversationId" | "projectId" | "runId" | "toolCallId" | "childAgentId"
>;

/** Public API contract for hosted durable child invoke trace overrides. */
export type HostedDurableChildInvokeTraceOverrides = Partial<
  Omit<HostedDurableChildInvokeTraceInput, keyof HostedDurableChildInvokeTraceBase>
>;

/** Public API contract for hosted durable child invoke trace recorder. */
export type HostedDurableChildInvokeTraceRecorder = ReturnType<
  typeof createHostedDurableChildInvokeTraceRecorder
>;

/** Public API contract for hosted local child invoke trace recorder. */
export type HostedLocalChildInvokeTraceRecorder = {
  recordLocalResult<TLocalResult extends ChildRunExecutionResult>(
    result: TLocalResult,
  ): TLocalResult;
  recordLocalFailure(errorMessage: string): void;
};

/** Input payload for execute hosted local child invoke. */
export type ExecuteHostedLocalChildInvokeInput = {
  forkInput: Pick<HostedChildForkToolInput, "description">;
  abortSignal?: AbortSignal;
  traceRecorder: HostedLocalChildInvokeTraceRecorder;
  execute: () => Promise<ChildRunExecutionResult> | ChildRunExecutionResult;
  getExecutionSnapshot?: () => ChildRunExecutionSnapshot | null;
  resultMode?: ChildRunResultMode;
  isAbortError?: (error: unknown) => boolean;
};

function buildHostedChildResultSummaryForMode(input: {
  result: ChildRunExecutionResult;
  snapshot: ChildRunExecutionSnapshot | null;
  resultMode?: ChildRunResultMode;
}): ChildRunResultSummary {
  if (input.snapshot?.fullResultText !== null && input.snapshot?.fullResultText !== undefined) {
    return buildChildRunResultSummary(input.snapshot.fullResultText, {
      mode: input.resultMode,
    });
  }

  return input.result.success
    ? input.result.summary
    : buildChildRunResultSummary(input.result.error);
}

/** Result returned from build hosted durable child invoke failure. */
export function buildHostedDurableChildInvokeFailureResult(
  input: BuildHostedDurableChildInvokeFailureResultInput,
): HostedDurableChildInvokeResult {
  const failureText = `invoke_agent failed: ${input.terminalErrorMessage}`;

  return {
    ok: false,
    status: "failed",
    text: failureText,
    summary: buildChildRunResultSummary(failureText),
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

/** Result returned from build hosted durable child invoke terminal failure. */
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

function resolveKnownProviderTerminalError(error: unknown): {
  code: string;
  message: string;
} | null {
  const parsedError = parseProviderError(error);
  if (
    parsedError.code === "EXTERNAL_SERVICE_ERROR" &&
    parsedError.message === "LLM provider service error"
  ) {
    return null;
  }

  return {
    code: parsedError.code,
    message: parsedError.message,
  };
}

/** Result returned from build hosted durable child invoke success. */
export function buildHostedDurableChildInvokeSuccessResult<
  TLocalResult extends ChildRunExecutionResult,
>(
  input: HostedDurableChildSuccess<TLocalResult>,
  options: HostedDurableChildInvokeSuccessResultOptions = {},
): HostedDurableChildInvokeResult {
  const summary = buildHostedChildResultSummaryForMode({
    result: input.result,
    snapshot: input.snapshot,
    resultMode: options.resultMode,
  });
  const terminalError = input.snapshot.success
    ? null
    : resolveKnownProviderTerminalError(input.snapshot.error);

  return {
    ok: input.snapshot.success,
    status: input.snapshot.success ? "completed" : "failed",
    ...(summary
      ? {
        text: summary.text,
        summary,
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
    terminalErrorCode: input.snapshot.success ? null : terminalError?.code ?? "INVOKE_AGENT_FAILED",
    terminalErrorMessage: input.snapshot.success
      ? null
      : terminalError?.message ?? input.snapshot.error,
  };
}

/** Create hosted durable child invoke trace recorder. */
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
      options: HostedDurableChildInvokeSuccessResultOptions = {},
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

      return buildHostedDurableChildInvokeSuccessResult(success, options);
    },
  };
}

/** Execute hosted local child invoke. */
export async function executeHostedLocalChildInvoke(
  input: ExecuteHostedLocalChildInvokeInput,
): Promise<ChildRunExecutionResult> {
  try {
    const result = await input.execute();
    const recordedResult = input.traceRecorder.recordLocalResult(result);

    if (input.resultMode !== "full" || !recordedResult.success) {
      return recordedResult;
    }

    return {
      ...recordedResult,
      summary: buildHostedChildResultSummaryForMode({
        result: recordedResult,
        snapshot: input.getExecutionSnapshot?.() ?? null,
        resultMode: input.resultMode,
      }),
    };
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

/** Context for hosted durable child bootstrap. */
export type HostedDurableChildBootstrapContext = {
  parentConversationId: string;
  parentRunId: string;
  parentMessageId: string;
  targets: ConversationRunTargets;
  resolvedModel: string;
  provider: string;
};

/** Public API contract for hosted durable child bootstrap callbacks. */
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

/** Public API contract for hosted durable child runtime dependencies. */
export type HostedDurableChildRuntimeDependencies = {
  bootstrapChildRun?: typeof bootstrapHostedChildRun;
  createLifecycleAdapter?: typeof createConversationChildLifecycleAdapter;
  runLifecycle?: typeof runHostedChildExecutionLifecycle;
  shouldSkipTerminalPersistence?: typeof shouldSkipHostedChildTerminalPersistence;
};

/** Input payload for execute hosted durable child fork. */
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
    const forkInput = withHostedChildInvocationContext(input.forkInput, {
      conversationId: input.bootstrapContext.parentConversationId,
      parentRunId: input.bootstrapContext.parentRunId,
      toolCallId: input.executionOptions.toolCallId,
    });

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
      description: forkInput.description,
      prompt: buildHostedChildForkEffectivePrompt({
        description: forkInput.description,
        prompt: forkInput.prompt,
        context: forkInput.context,
        runId: input.executionOptions.toolCallId,
      }),
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
      sourceTargetKind: targets.sourceTargetKind,
      runtimeTargetKind: targets.runtimeTargetKind,
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
      status: lifecycleResult.terminalState.status,
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

/** Execute hosted durable child fork. */
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
