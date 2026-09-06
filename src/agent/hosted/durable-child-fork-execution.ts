import type {
  ChildRunExecutionResult,
  ChildRunExecutionSnapshot,
} from "../child-run/execution-snapshot.ts";
import { defineSchema } from "#veryfront/schemas";
import { resolveKnownProviderTerminalError } from "../streaming/stream-outcome.ts";
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
  type HostedChildInvocationContext,
  withHostedChildInvocationContext,
} from "./child-tool-input.ts";
import { isChildRunAbortError, throwIfChildRunAborted } from "../child-run/execution-support.ts";
import {
  type HostedProjectReferenceResolver,
  requireConfirmedHostedProjectReference,
  resolveHostedProjectReference,
} from "./project-reference-resolver.ts";
import {
  getActiveHostedRunEventWriterCapability,
  HostedChildRunEventWriterTokenExchangeError,
  type HostedRunEventWriterCapability,
  runWithHostedRunEventWriterCapability,
} from "./child-run-event-writer-token.ts";

const CHILD_RUN_FINALIZATION_ERROR = "Unable to finalize durable child run after setup failure";

/** Sanitized failure raised when setup-failure finalization itself cannot be persisted. */
export class HostedChildRunFinalizationError extends Error {
  constructor() {
    super(CHILD_RUN_FINALIZATION_ERROR);
    this.name = "HostedChildRunFinalizationError";
  }
}

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

/**
 * Published contract for the `invoke_agent` tool result this module writes.
 *
 * Split by status rather than flattened: a `completed` envelope must carry the
 * child identifiers, because a consumer reading it back has no other way to
 * locate the child run. A terminal envelope may omit them, since a setup failure
 * can happen before the child exists. Flattening the two would let a completed
 * result lose an identifier while conformance tests stayed green.
 *
 * Deliberately permissive about extra run telemetry it does not name: this pins
 * the fields consumers depend on, and closing the shape would make any additive
 * change here a cross-repo deploy-order problem.
 * See veryfront/veryfront-issue-inbox#423.
 */
export const getHostedDurableChildInvokeResultSchema = defineSchema((v) => {
  const base = v.object({
    ok: v.boolean(),
    text: v.string().optional(),
    error: v.string().optional(),
    summary: v.object({ text: v.string() }).passthrough().optional(),
    steps: v.number().optional(),
    toolCalls: v.array(v.unknown()).optional(),
    toolResults: v.array(v.unknown()).optional(),
    usage: v.record(v.string(), v.unknown()).optional(),
    durationMs: v.number().optional(),
    sourceTargetKind: v.string().nullable().optional(),
    runtimeTargetKind: v.string().nullable().optional(),
    terminalErrorCode: v.string().nullable(),
    terminalErrorMessage: v.string().nullable(),
  });

  return v.discriminatedUnion("status", [
    base.extend({
      status: v.literal("completed"),
      childConversationId: v.string(),
      childRunId: v.string(),
      childMessageId: v.string(),
    }).passthrough(),
    base.extend({
      status: v.literal("failed"),
      childConversationId: v.string().nullable().optional(),
      childRunId: v.string().nullable().optional(),
      childMessageId: v.string().nullable().optional(),
    }).passthrough(),
  ]);
});

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
    terminalErrorCode: input.snapshot.success
      ? null
      : input.snapshot.terminalErrorCode ?? terminalError?.code ?? "INVOKE_AGENT_FAILED",
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
        terminalErrorCode: result.success
          ? null
          : result.terminalErrorCode ?? input.executionFailedCode,
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
        targetEnvironmentId: failure.targets.targetEnvironmentId,
        targetBranchId: failure.targets.targetBranchId,
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
        targetEnvironmentId: failure.targets.targetEnvironmentId,
        targetBranchId: failure.targets.targetBranchId,
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
        targetEnvironmentId: success.targets.targetEnvironmentId,
        targetBranchId: success.targets.targetBranchId,
        status: success.snapshot.success ? "completed" : "failed",
        usage: success.snapshot.usage,
        terminalErrorCode: success.snapshot.success
          ? null
          : success.snapshot.terminalErrorCode ?? input.executionFailedCode,
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

/**
 * Input for bootstrapping and executing a hosted durable child fork.
 * `runEventWriterCapability` carries exact-parent authority; this helper mints
 * the exact-child capability only after the child run is persisted.
 */
export type ExecuteHostedDurableChildForkInput<
  TResult,
  TLocalResult extends ChildRunExecutionResult,
> = {
  authToken: string;
  apiUrl: string;
  /** Opaque exact-parent authority used only to mint this invocation's child writer. */
  runEventWriterCapability?: HostedRunEventWriterCapability;
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
  trustedInvocationContext?: HostedChildInvocationContext;
  getProjectId: () => string | null | undefined;
  getRuntimeTargetKind?: () => ConversationRunTargets["runtimeTargetKind"] | undefined;
  getRuntimeTargetEnvironmentId?: () => string | null | undefined;
  getBranchId?: () => string | null | undefined;
  getContextModel?: () => string | undefined;
  resolveProjectReference?: HostedProjectReferenceResolver;
  defaultModel: string;
  resolveModelId: (model: string) => string;
  resolveProvider: (modelId: string) => string;
  onRequestedProjectId?: (projectId: string, projectSlug?: string) => Promise<void> | void;
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

function getRuntimeTargetKind(input: {
  getRuntimeTargetKind?: () => ConversationRunTargets["runtimeTargetKind"] | undefined;
}): ConversationRunTargets["runtimeTargetKind"] | undefined {
  return input.getRuntimeTargetKind?.();
}

function getRuntimeTargetEnvironmentId(input: {
  getRuntimeTargetEnvironmentId?: () => string | null | undefined;
}): string | null | undefined {
  return input.getRuntimeTargetEnvironmentId?.();
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

function getRequestedProjectReference(forkInput: HostedChildForkToolInput): string | null {
  return forkInput.project_reference ?? null;
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
  const requestedProjectReference = getRequestedProjectReference(input.forkInput);
  if (requestedProjectReference) {
    const resolver = input.resolveProjectReference ?? resolveHostedProjectReference;
    const resolution = await resolver({
      projectReference: requestedProjectReference,
      authToken: input.authToken,
      apiUrl: input.apiUrl,
      abortSignal: input.executionOptions.abortSignal,
    });
    const resolvedProject = requireConfirmedHostedProjectReference(
      resolution,
      requestedProjectReference,
    );
    await input.onRequestedProjectId?.(
      resolvedProject.projectId,
      resolvedProject.projectSlug,
    );
  }

  const targets = resolveConversationRunTargets({
    projectId: input.getProjectId() ?? null,
    runtimeTargetKind: getRuntimeTargetKind(input) ?? null,
    environmentId: getRuntimeTargetEnvironmentId(input) ?? null,
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
      parentConversationId: input.bootstrapContext.parentConversationId,
      conversationId: input.bootstrapContext.parentConversationId,
      parentRunId: input.bootstrapContext.parentRunId,
      parentMessageId: input.bootstrapContext.parentMessageId,
      toolCallId: input.executionOptions.toolCallId,
      trustedInvocationContext: input.trustedInvocationContext,
    });

    const bootstrapChildRun = input.runtime?.bootstrapChildRun ?? bootstrapHostedChildRun;
    const run = await bootstrapChildRun({
      authToken: input.authToken,
      apiUrl: input.apiUrl,
      ensureProjectId: input.getProjectId() ?? undefined,
      runProjectId: getRequestedProjectReference(input.forkInput)
        ? input.getProjectId() ?? undefined
        : input.runProjectId !== undefined
        ? input.runProjectId
        : input.getProjectId() ?? undefined,
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
      runtimeTargetKind: getRuntimeTargetKind(input),
      runtimeTargetEnvironmentId: getRuntimeTargetEnvironmentId(input),
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
    childRunEventWriterCapability: HostedRunEventWriterCapability;
  },
): Promise<TResult> {
  const { bootstrapContext, identifiers } = input;
  const { targets } = bootstrapContext;
  const lifecycleAdapter = createDurableChildLifecycleAdapter(input);

  const runLifecycle = input.runtime?.runLifecycle ?? runHostedChildExecutionLifecycle;
  const skipTerminalPersistence = input.runtime?.shouldSkipTerminalPersistence ??
    shouldSkipHostedChildTerminalPersistence;
  const lifecycleResult = await runLifecycle({
    adapter: lifecycleAdapter,
    executionFailedCode: input.executionFailedCode,
    abortSignal: input.executionOptions.abortSignal,
    execute: () =>
      runWithHostedRunEventWriterCapability(
        input.childRunEventWriterCapability,
        () => input.executeLocal({ durableChildRun: identifiers }),
      ),
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

function createDurableChildLifecycleAdapter<
  TResult,
  TLocalResult extends ChildRunExecutionResult,
>(
  input: ExecuteHostedDurableChildForkInput<TResult, TLocalResult> & {
    bootstrapContext: HostedDurableChildBootstrapContext;
    identifiers: HostedChildRunIdentifiers;
  },
) {
  const { bootstrapContext, identifiers } = input;
  const { targets } = bootstrapContext;
  const createLifecycleAdapter = input.runtime?.createLifecycleAdapter ??
    createConversationChildLifecycleAdapter;

  return createLifecycleAdapter({
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
      targetEnvironmentId: targets.targetEnvironmentId,
      targetBranchId: targets.targetBranchId,
    },
    model: bootstrapContext.resolvedModel,
    provider: bootstrapContext.provider,
  });
}

/** Report an observability callback failure without changing durable setup control flow. */
async function notifyBootstrapError(
  callbacks: {
    onBootstrapError?: HostedDurableChildBootstrapCallbacks["onBootstrapError"];
    onCallbackError?: (error: unknown) => Promise<void> | void;
  },
  payload: { error: unknown; parentConversationId: string; toolCallId: string },
): Promise<void> {
  try {
    await callbacks.onBootstrapError?.(payload);
  } catch (callbackError) {
    try {
      await callbacks.onCallbackError?.(callbackError);
    } catch {
      // Observability must not alter durable setup or terminal persistence.
    }
  }
}

/** Execute hosted durable child fork. */
export async function executeHostedDurableChildFork<
  TResult,
  TLocalResult extends ChildRunExecutionResult,
>(
  input: ExecuteHostedDurableChildForkInput<TResult, TLocalResult>,
): Promise<TResult> {
  const runEventWriterCapability = input.runEventWriterCapability ??
    getActiveHostedRunEventWriterCapability();
  return await runWithHostedRunEventWriterCapability(
    undefined,
    () => executeHostedDurableChildForkWithCapability(input, runEventWriterCapability),
  );
}

async function executeHostedDurableChildForkWithCapability<
  TResult,
  TLocalResult extends ChildRunExecutionResult,
>(
  input: ExecuteHostedDurableChildForkInput<TResult, TLocalResult>,
  runEventWriterCapability: HostedRunEventWriterCapability | undefined,
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
    await notifyBootstrapError(
      {
        onBootstrapError: input.bootstrap?.onBootstrapError,
        onCallbackError: input.onLifecycleError,
      },
      {
        error,
        parentConversationId: bootstrapContext.parentConversationId,
        toolCallId: input.executionOptions.toolCallId,
      },
    );

    return input.buildSetupFailureResult({
      targets,
      childConversationId: null,
      childRunId: null,
      childMessageId: null,
      terminalErrorCode: input.setupFailedCode,
      terminalErrorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  let childRunEventWriterCapability: HostedRunEventWriterCapability;
  try {
    if (!runEventWriterCapability) {
      throw new HostedChildRunEventWriterTokenExchangeError();
    }
    childRunEventWriterCapability = await runEventWriterCapability
      .mintChildRunEventWriterCapability(
        identifiers.childRunId,
        input.executionOptions.abortSignal,
      );
  } catch (error) {
    const setupError = new HostedChildRunEventWriterTokenExchangeError(
      error instanceof HostedChildRunEventWriterTokenExchangeError
        ? error.classification
        : input.executionOptions.abortSignal?.aborted
        ? "aborted"
        : "failed",
    );
    await notifyBootstrapError(
      {
        onBootstrapError: input.bootstrap?.onBootstrapError,
        onCallbackError: input.onLifecycleError,
      },
      {
        error: setupError,
        parentConversationId: bootstrapContext.parentConversationId,
        toolCallId: input.executionOptions.toolCallId,
      },
    );

    const cancelled = setupError.classification === "aborted";
    const terminalState = cancelled
      ? {
        status: "cancelled" as const,
        terminalErrorCode: "CANCELLED",
        terminalErrorMessage: "Child run cancelled",
      }
      : {
        status: "failed" as const,
        terminalErrorCode: input.setupFailedCode,
        terminalErrorMessage: setupError.message,
      };
    try {
      const lifecycleAdapter = createDurableChildLifecycleAdapter({
        ...input,
        bootstrapContext,
        identifiers,
      });
      if (cancelled) {
        if (!lifecycleAdapter.cancelled) {
          throw new HostedChildRunFinalizationError();
        }
        await lifecycleAdapter.cancelled(terminalState);
      } else {
        if (!lifecycleAdapter.failed) {
          throw new HostedChildRunFinalizationError();
        }
        await lifecycleAdapter.failed(terminalState);
      }
    } catch {
      const finalizationError = new HostedChildRunFinalizationError();
      try {
        await input.onLifecycleError?.(finalizationError);
      } catch {
        // Terminal persistence failure remains authoritative and sanitized.
      }
      throw finalizationError;
    }

    if (cancelled) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    const failure = {
      targets,
      childConversationId: identifiers.childConversationId,
      childRunId: identifiers.childRunId,
      childMessageId: identifiers.childMessageId,
      terminalErrorCode: terminalState.terminalErrorCode,
      terminalErrorMessage: terminalState.terminalErrorMessage,
    };
    return input.buildSetupFailureResult(failure);
  }

  return executeHostedDurableChildLifecycle({
    ...input,
    bootstrapContext,
    identifiers,
    childRunEventWriterCapability,
  });
}
