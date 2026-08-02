import type { HostToolTraceAttributes } from "#veryfront/tool";
import { buildChildRunFailureResult } from "../child-run/execution-snapshot.ts";
import {
  createHostedDurableChildForkRunContext,
  executeHostedChildForkRunContextStream,
  finalizeHostedChildForkRunContextResources,
  handleHostedChildForkRunContextError,
  type HostedDurableChildForkRunContext,
} from "./child-fork-run-context.ts";
import { type DefaultHostedChildForkToolAssemblyResult } from "./child-requested-tools.ts";
import {
  addLoadSkillContinuationReminder,
  shouldReinforceLoadSkillContinuation,
} from "../conversation/delegation-policy.ts";
import {
  buildHostedChildForkInstructions,
  type HostedChildForkInstructionsContext,
} from "./child-fork-instructions.ts";
import {
  type HostedChildForkRuntimeStepSystemResolver,
  prepareHostedChildForkRuntimeStepMessages,
} from "./child-fork-step-message-preparation.ts";
import {
  type StartedHostedChildForkRuntime,
  startHostedChildForkRuntimeWithHostTools,
  type StartHostedChildForkRuntimeWithHostToolsInput,
} from "./child-fork-runtime-start.ts";
import {
  type AgentRuntimeForkStepRunner,
  runAgentRuntimeForkStep,
} from "../streaming/fork-runtime-stream.ts";
import type {
  ChildRunExecutionResult,
  ChildRunExecutionSnapshot,
} from "../child-run/execution-snapshot.ts";
import type { ChildRunResultMode } from "../child-run/result-summary.ts";
import type { RuntimeReasoningOption } from "../types.ts";
import type {
  HostedConversationRunChunkMirrorInstrumentation,
  HostedConversationRunChunkMirrorTraceAttributes,
} from "../conversation/run-chunk-mirror.ts";
import type { HostedChildExecutionLogEntry } from "./child-execution-logging.ts";
import type {
  HostedChildForkStreamLogger,
  HostedChildForkStreamTraceInput,
} from "./child-fork-stream-execution.ts";
import type { HostedChildRunIdentifiers } from "./child-status.ts";
import { throwIfChildRunAborted } from "../child-run/execution-support.ts";
import {
  type HostedChildForkRuntimeConfig,
  type HostedChildForkToolInput,
  type HostedChildInvocationContext,
  resolveHostedChildForkRuntimeConfig,
  type ResolveHostedChildForkRuntimeConfigInput,
  withHostedChildInvocationContext,
} from "./child-tool-input.ts";
import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import {
  type HostedProjectReferenceResolver,
  resolveHostedProjectReference,
} from "./project-reference-resolver.ts";
import {
  applyAgentProjectContextChange,
  type ConfirmedAgentProjectContextSwitch,
  getConfirmedResolvedAgentProjectIdentity,
  INVALID_AGENT_PROJECT_REFERENCE_MESSAGE,
  type MutableAgentProjectContext,
  normalizeAgentProjectIdentity,
  normalizeAgentProjectReference,
  UNCONFIRMED_AGENT_PROJECT_IDENTITY_MESSAGE,
} from "../project/context.ts";

/** Default value for hosted child fork stream idle timeout ms. */
export const DEFAULT_HOSTED_CHILD_FORK_STREAM_IDLE_TIMEOUT_MS = 45_000;
/** Default value for hosted child fork stream active tool timeout ms. */
export const DEFAULT_HOSTED_CHILD_FORK_STREAM_ACTIVE_TOOL_TIMEOUT_MS = 5 * 60_000;
/** Default value for hosted child fork stream post tool idle timeout ms. */
export const DEFAULT_HOSTED_CHILD_FORK_STREAM_POST_TOOL_IDLE_TIMEOUT_MS = 2 * 60_000;
/** Default value for hosted child fork stream finalization timeout ms. */
export const DEFAULT_HOSTED_CHILD_FORK_STREAM_FINALIZATION_TIMEOUT_MS = 10_000;
/** Default value for hosted child status poll interval ms. */
export const DEFAULT_HOSTED_CHILD_STATUS_POLL_INTERVAL_MS = 2_000;

/** Public API contract for hosted child fork execution instrumentation. */
export type HostedChildForkExecutionInstrumentation<
  TAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
> = {
  trace?: <TResult>(operationName: string, operation: () => TResult) => TResult;
  setTraceAttributes?: (
    attributes: TAttributes | HostedConversationRunChunkMirrorTraceAttributes,
  ) => void;
  buildToolTraceAttributes?: (input: {
    toolName: string;
    toolCallId: string | undefined;
  }) => TAttributes | undefined;
  tracePart?: (input: HostedChildForkStreamTraceInput) => void | Promise<void>;
  debug?: (message: string, metadata?: Record<string, unknown>) => void;
  warn?: (message: string, metadata?: Record<string, unknown>) => void;
  error?: (message: string, metadata?: Record<string, unknown>) => void;
};

export type HostedChildForkExecutionRunContextFactoryInput<
  TAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
> = {
  authToken: string;
  apiUrl: string;
  durableChildRun?: HostedChildRunIdentifiers;
  conversationId?: string;
  parentRunId?: string;
  description: string;
  instrumentation?: HostedChildForkExecutionInstrumentation<TAttributes>;
  pendingToolLogWriter?: { warn: (message: string, metadata?: Record<string, unknown>) => void };
};

/** Project context carried from child tool preparation into fork execution. */
export type HostedChildForkExecutionProjectContext =
  & HostedChildForkInstructionsContext
  & {
    projectSlug?: string;
    runtimeTargetKind?: "main_branch" | "environment" | "preview_branch" | null;
    runtimeTargetEnvironmentId?: string | null;
    skillSourcePaths?: Readonly<Record<string, string>>;
  };

/** Input payload for execute hosted child fork with prepared tools. */
export type ExecuteHostedChildForkWithPreparedToolsInput<
  TAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
> = {
  authToken: string;
  apiUrl: string;
  projectId?: string | null;
  projectSlug?: string;
  description: string;
  kind: string;
  provider: string;
  forkModel: string;
  temperature?: number;
  maxSteps: number;
  effectivePrompt: string;
  forkContext?: HostedChildForkExecutionProjectContext;
  resolveForkContext?: () => HostedChildForkExecutionProjectContext | undefined;
  resolveStepContext?: StartHostedChildForkRuntimeWithHostToolsInput<
    TAttributes
  >["resolveStepContext"];
  toolAssembly: DefaultHostedChildForkToolAssemblyResult;
  abortSignal?: AbortSignal;
  durableChildRun?: HostedChildRunIdentifiers;
  parentConversationId?: string;
  conversationId?: string;
  parentRunId?: string;
  parentMessageId?: string;
  trustedInvocationContext?: HostedChildInvocationContext;
  pendingToolLogWriter?: { warn: (message: string, metadata?: Record<string, unknown>) => void };
  logger?: HostedChildForkStreamLogger;
  instrumentation?: HostedChildForkExecutionInstrumentation<TAttributes>;
  providerOptions?: Record<string, unknown>;
  reasoning?: RuntimeReasoningOption;
  sourceIntegrationPolicy?: SourceIntegrationPolicyManifest;
  maxContinuationSteps?: number;
  resolveSystem?: HostedChildForkRuntimeStepSystemResolver;
  buildInstructions?: () => string;
  onBeforeStop?: StartHostedChildForkRuntimeWithHostToolsInput<TAttributes>["onBeforeStop"];
  runStep?: AgentRuntimeForkStepRunner;
  createRunContext?: (
    input: HostedChildForkExecutionRunContextFactoryInput<TAttributes>,
  ) => HostedDurableChildForkRunContext;
  startRuntime?: (
    input: StartHostedChildForkRuntimeWithHostToolsInput<TAttributes>,
  ) => StartedHostedChildForkRuntime | Promise<StartedHostedChildForkRuntime>;
  childRunMonitorPollIntervalMs?: number;
  idleTimeoutMs?: number;
  activeToolTimeoutMs?: number;
  postToolIdleTimeoutMs?: number;
  finalizationTimeoutMs?: number;
  startTime?: number;
  resultMode?: ChildRunResultMode;
  onSettled?: (snapshot: ChildRunExecutionSnapshot) => void | Promise<void>;
  writeLog?: (entry: HostedChildExecutionLogEntry) => void;
  shouldRethrowError?: (error: unknown) => boolean;
};

function createForkRunContext<
  TAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
>(
  input: HostedChildForkExecutionRunContextFactoryInput<TAttributes>,
): HostedDurableChildForkRunContext {
  const sourceInstrumentation = input.instrumentation;
  const sourceTrace = sourceInstrumentation?.trace;
  const instrumentation: HostedConversationRunChunkMirrorInstrumentation | undefined =
    sourceInstrumentation
      ? {
        trace: sourceTrace
          ? <TResult>(operationName: string, operation: () => Promise<TResult>) =>
            sourceTrace(operationName, operation)
          : undefined,
        setTraceAttributes: sourceInstrumentation.setTraceAttributes,
        debug: sourceInstrumentation.debug,
        warn: sourceInstrumentation.warn,
        error: sourceInstrumentation.error,
      }
      : undefined;

  return createHostedDurableChildForkRunContext({
    authToken: input.authToken,
    apiUrl: input.apiUrl,
    durableChildRun: input.durableChildRun,
    instrumentation,
    pendingToolLogContext: {
      conversationId: input.conversationId,
      parentRunId: input.parentRunId,
      description: input.description,
    },
    pendingToolLogWriter: input.pendingToolLogWriter,
  });
}

function defaultResolveSystem(input: {
  system: string;
  compactedMessages: Parameters<HostedChildForkRuntimeStepSystemResolver>[0]["compactedMessages"];
}): string {
  if (!shouldReinforceLoadSkillContinuation([...input.compactedMessages])) {
    return input.system;
  }

  const remindedSystem = addLoadSkillContinuationReminder(input.system);
  return typeof remindedSystem === "string" ? remindedSystem : input.system;
}

/** Options accepted by execute hosted child fork tool input. */
export type ExecuteHostedChildForkToolInputOptions<
  TAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
> =
  & Omit<
    ExecuteHostedChildForkWithPreparedToolsInput<TAttributes>,
    | "description"
    | "provider"
    | "forkModel"
    | "maxSteps"
    | "effectivePrompt"
    | "toolAssembly"
    | "providerOptions"
    | "reasoning"
  >
  & {
    forkInput: HostedChildForkToolInput;
    toolCallId: string;
    defaultModel: string;
    defaultMaxSteps: number;
    contextModel?: string;
    onRequestedProjectId?: (
      projectId: string,
      projectSlug?: string,
    ) => void | Promise<void>;
    resolveProjectReference?: HostedProjectReferenceResolver;
    prepareToolAssembly: (input: {
      runtimeConfig: HostedChildForkRuntimeConfig;
      requestedTools?: HostedChildForkToolInput["tools"];
      abortSignal?: AbortSignal;
      projectId: string | null;
      projectSlug?: string;
      forkContext?: HostedChildForkExecutionProjectContext;
    }) =>
      | DefaultHostedChildForkToolAssemblyResult
      | Promise<DefaultHostedChildForkToolAssemblyResult>;
    resolveModelId: ResolveHostedChildForkRuntimeConfigInput["resolveModelId"];
    resolveProvider: ResolveHostedChildForkRuntimeConfigInput["resolveProvider"];
    resolveProviderOptions?: (
      forkModel: string,
      thinkingConfig: HostedChildForkRuntimeConfig["thinkingConfig"],
    ) => Record<string, unknown> | undefined;
    resolveReasoning?: (
      forkModel: string,
      thinkingConfig: HostedChildForkRuntimeConfig["thinkingConfig"],
    ) => RuntimeReasoningOption | undefined;
    resolveModelThinking?: ResolveHostedChildForkRuntimeConfigInput["resolveModelThinking"];
    onRuntimeConfig?: (runtimeConfig: HostedChildForkRuntimeConfig) => void | Promise<void>;
    inputAlreadyHasInvocationContext?: boolean;
  };

type HostedChildForkProjectContextSnapshot = {
  projectId: string;
  projectSlug?: string;
};

const INCONSISTENT_HOSTED_CHILD_FORK_PROJECT_CONTEXT_MESSAGE =
  "Hosted child fork project identity inputs must describe one canonical project";

function getHostedChildForkProjectContextSnapshot(
  context: HostedChildForkExecutionProjectContext | undefined,
): HostedChildForkProjectContextSnapshot | null {
  if (!context?.projectId) {
    return null;
  }

  return normalizeAgentProjectIdentity(context.projectId, context.projectSlug);
}

function isSameHostedChildForkProjectContext(
  left: HostedChildForkProjectContextSnapshot | null,
  right: HostedChildForkProjectContextSnapshot | null,
): boolean {
  return left?.projectId === right?.projectId &&
    left?.projectSlug === right?.projectSlug;
}

function isAuthoritativeResolvedHostedChildForkContext(
  candidate: HostedChildForkExecutionProjectContext | undefined,
  resolved: HostedChildForkExecutionProjectContext | undefined,
): boolean {
  return isSameHostedChildForkProjectContext(
    getHostedChildForkProjectContextSnapshot(candidate),
    getHostedChildForkProjectContextSnapshot(resolved),
  ) &&
    candidate?.branchId === resolved?.branchId &&
    candidate?.runtimeTargetKind === resolved?.runtimeTargetKind &&
    candidate?.runtimeTargetEnvironmentId === resolved?.runtimeTargetEnvironmentId;
}

function hasConsistentHostedChildForkRuntimeTarget(
  context: HostedChildForkExecutionProjectContext,
): boolean {
  if (context.runtimeTargetKind === "main_branch") {
    return context.branchId == null && context.runtimeTargetEnvironmentId == null;
  }
  if (context.runtimeTargetKind === "environment") {
    return context.branchId == null &&
      typeof context.runtimeTargetEnvironmentId === "string" &&
      context.runtimeTargetEnvironmentId.trim().length > 0;
  }
  if (context.runtimeTargetKind === "preview_branch") {
    return typeof context.branchId === "string" &&
      context.branchId.trim().length > 0 &&
      context.runtimeTargetEnvironmentId == null;
  }
  return false;
}

function createResolvedHostedChildForkProjectContext(input: {
  forkContext?: HostedChildForkExecutionProjectContext;
  projectId?: string | null;
  resolvedProject: ConfirmedAgentProjectContextSwitch;
}): HostedChildForkExecutionProjectContext {
  const { availableSkillIds, ...forkContext } = input.forkContext ?? {};
  const priorProjectId = input.projectId &&
      input.projectId !== input.resolvedProject.projectId
    ? input.projectId
    : input.forkContext?.projectId ?? input.projectId ?? "";
  const context: MutableAgentProjectContext = {
    ...forkContext,
    projectId: priorProjectId,
    ...(availableSkillIds ? { availableSkillIds: [...availableSkillIds] } : {}),
  };
  applyAgentProjectContextChange(
    context,
    input.resolvedProject.projectId,
    input.resolvedProject.projectSlug,
  );
  return context;
}

function resolveInitialHostedChildForkProjectContext(input: {
  projectId?: string | null;
  projectSlug?: string;
  forkContext?: HostedChildForkExecutionProjectContext;
}): HostedChildForkProjectContextSnapshot | null {
  const hasInputProjectId = input.projectId !== undefined && input.projectId !== null;
  const inputIdentity = hasInputProjectId
    ? normalizeAgentProjectIdentity(input.projectId, input.projectSlug)
    : null;
  const hasForkContextProjectId = input.forkContext?.projectId !== undefined &&
    input.forkContext.projectId !== null;
  const forkContextIdentity = hasForkContextProjectId
    ? getHostedChildForkProjectContextSnapshot(input.forkContext)
    : null;

  if (
    (hasInputProjectId && !inputIdentity) ||
    (!hasInputProjectId && input.projectSlug !== undefined) ||
    (hasForkContextProjectId && !forkContextIdentity) ||
    (!hasForkContextProjectId && input.forkContext?.projectSlug !== undefined) ||
    (
      inputIdentity &&
      forkContextIdentity &&
      (
        inputIdentity.projectId !== forkContextIdentity.projectId ||
        (
          inputIdentity.projectSlug !== undefined &&
          forkContextIdentity.projectSlug !== undefined &&
          inputIdentity.projectSlug !== forkContextIdentity.projectSlug
        )
      )
    )
  ) {
    throw new TypeError(INCONSISTENT_HOSTED_CHILD_FORK_PROJECT_CONTEXT_MESSAGE);
  }

  if (inputIdentity) {
    const projectSlug = inputIdentity.projectSlug ?? forkContextIdentity?.projectSlug;
    return {
      projectId: inputIdentity.projectId,
      ...(projectSlug ? { projectSlug } : {}),
    };
  }
  return forkContextIdentity;
}

function createInitialHostedChildForkExecutionContext(
  forkContext: HostedChildForkExecutionProjectContext | undefined,
  projectContext: HostedChildForkProjectContextSnapshot | null,
): HostedChildForkExecutionProjectContext | undefined {
  if (!forkContext || !projectContext) {
    return forkContext;
  }

  const { projectSlug: _projectSlug, ...context } = forkContext;
  return {
    ...context,
    projectId: projectContext.projectId,
    ...(projectContext.projectSlug ? { projectSlug: projectContext.projectSlug } : {}),
  };
}

/** Input payload for execute hosted child fork tool. */
export async function executeHostedChildForkToolInput<
  TAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
>(
  input: ExecuteHostedChildForkToolInputOptions<TAttributes>,
): Promise<ChildRunExecutionResult> {
  const rawRequestedProjectReference = input.forkInput.project_reference;
  const requestedProjectReference = rawRequestedProjectReference === undefined
    ? undefined
    : normalizeAgentProjectReference(rawRequestedProjectReference);
  if (rawRequestedProjectReference !== undefined && !requestedProjectReference) {
    throw new TypeError(INVALID_AGENT_PROJECT_REFERENCE_MESSAGE);
  }
  const initialProjectContext = resolveInitialHostedChildForkProjectContext(input);
  let resolvedProject: ConfirmedAgentProjectContextSwitch | null = null;
  let effectiveForkContext = createInitialHostedChildForkExecutionContext(
    input.forkContext,
    initialProjectContext,
  );
  let effectiveProjectId = initialProjectContext?.projectId ?? null;
  let effectiveProjectSlug = initialProjectContext?.projectSlug;

  if (requestedProjectReference) {
    const resolver = input.resolveProjectReference ?? resolveHostedProjectReference;
    const rawResolvedProject = await resolver({
      projectReference: requestedProjectReference,
      authToken: input.authToken,
      apiUrl: input.apiUrl,
      abortSignal: input.abortSignal,
    });
    resolvedProject = getConfirmedResolvedAgentProjectIdentity(
      rawResolvedProject,
      requestedProjectReference,
    );
    if (!resolvedProject) {
      throw new Error(UNCONFIRMED_AGENT_PROJECT_IDENTITY_MESSAGE);
    }

    effectiveProjectId = resolvedProject.projectId;
    effectiveProjectSlug = resolvedProject.projectSlug;
    effectiveForkContext = createResolvedHostedChildForkProjectContext({
      forkContext: input.forkContext,
      projectId: input.projectId,
      resolvedProject,
    });
    await input.onRequestedProjectId?.(
      resolvedProject.projectId,
      resolvedProject.projectSlug,
    );
  }

  const externalContextBaseline = getHostedChildForkProjectContextSnapshot(input.forkContext);
  let followExternalForkContext = isAuthoritativeResolvedHostedChildForkContext(
    input.forkContext,
    effectiveForkContext,
  );
  const resolveForkContext = (): HostedChildForkExecutionProjectContext | undefined => {
    if (!input.forkContext) {
      return effectiveForkContext;
    }

    const liveContextSnapshot = getHostedChildForkProjectContextSnapshot(input.forkContext);
    if (
      !followExternalForkContext &&
      liveContextSnapshot &&
      hasConsistentHostedChildForkRuntimeTarget(input.forkContext) &&
      !isSameHostedChildForkProjectContext(liveContextSnapshot, externalContextBaseline)
    ) {
      // A later complete identity/target change is the child tool layer's
      // confirmed navigation result. Follow that live object so sibling tool
      // calls and subsequent steps observe the new project.
      followExternalForkContext = true;
    }

    return followExternalForkContext && liveContextSnapshot
      ? input.forkContext
      : effectiveForkContext;
  };

  const forkInput = input.inputAlreadyHasInvocationContext
    ? input.forkInput
    : withHostedChildInvocationContext(input.forkInput, {
      parentConversationId: input.parentConversationId,
      conversationId: input.conversationId,
      parentRunId: input.parentRunId,
      parentMessageId: input.parentMessageId,
      toolCallId: input.toolCallId,
      trustedInvocationContext: input.trustedInvocationContext,
    });
  const runtimeConfig = resolveHostedChildForkRuntimeConfig({
    forkInput,
    contextModel: input.contextModel,
    defaultModel: input.defaultModel,
    defaultMaxSteps: input.defaultMaxSteps,
    runId: input.durableChildRun?.childRunId ?? input.toolCallId,
    resolveModelId: input.resolveModelId,
    resolveProvider: input.resolveProvider,
    resolveModelThinking: input.resolveModelThinking,
  });

  await input.onRuntimeConfig?.(runtimeConfig);

  const preparedForkContext = resolveForkContext();
  const toolAssembly = await input.prepareToolAssembly({
    runtimeConfig,
    requestedTools: runtimeConfig.requestedTools,
    abortSignal: input.abortSignal,
    projectId: effectiveProjectId,
    ...(effectiveProjectSlug ? { projectSlug: effectiveProjectSlug } : {}),
    forkContext: preparedForkContext,
  });

  return executeHostedChildForkWithPreparedTools({
    ...input,
    projectId: effectiveProjectId,
    projectSlug: effectiveProjectSlug,
    forkContext: effectiveForkContext,
    resolveForkContext,
    resolveStepContext: () => {
      const currentForkContext = resolveForkContext();
      const currentProject = getHostedChildForkProjectContextSnapshot(currentForkContext);
      const currentProjectSlug = currentProject ? currentProject.projectSlug : effectiveProjectSlug;
      return {
        authToken: input.authToken,
        projectId: currentProject?.projectId ?? effectiveProjectId,
        ...(currentProjectSlug ? { projectSlug: currentProjectSlug } : {}),
      };
    },
    description: runtimeConfig.description,
    provider: runtimeConfig.provider,
    forkModel: runtimeConfig.forkModel,
    temperature: runtimeConfig.temperature,
    maxSteps: runtimeConfig.maxSteps,
    effectivePrompt: runtimeConfig.effectivePrompt,
    toolAssembly,
    providerOptions: input.resolveProviderOptions?.(
      runtimeConfig.forkModel,
      runtimeConfig.thinkingConfig,
    ),
    reasoning: input.resolveReasoning?.(
      runtimeConfig.forkModel,
      runtimeConfig.thinkingConfig,
    ),
    resultMode: forkInput.result_mode,
  });
}

/** Execute hosted child fork with prepared tools. */
export async function executeHostedChildForkWithPreparedTools<
  TAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
>(
  input: ExecuteHostedChildForkWithPreparedToolsInput<TAttributes>,
): Promise<ChildRunExecutionResult> {
  const startTime = input.startTime ?? Date.now();
  const createRunContext = input.createRunContext ?? createForkRunContext;
  const runContext = createRunContext({
    authToken: input.authToken,
    apiUrl: input.apiUrl,
    durableChildRun: input.durableChildRun,
    conversationId: input.conversationId,
    parentRunId: input.parentRunId,
    description: input.description,
    instrumentation: input.instrumentation,
    pendingToolLogWriter: input.pendingToolLogWriter,
  });

  let closeTooling: (() => Promise<void>) | undefined;
  let closeRuntime: (() => Promise<void>) | undefined;
  let childRunMonitorAbortController: AbortController | null = null;
  let childRunMonitorPromise: Promise<void> = Promise.resolve();

  try {
    throwIfChildRunAborted(input.abortSignal);
    if (!input.toolAssembly.ok) {
      return buildChildRunFailureResult(
        {
          description: input.description,
          steps: 0,
          toolCalls: [],
          toolResults: [],
          durationMs: Date.now() - startTime,
        },
        input.toolAssembly.errorMessage,
      );
    }

    closeTooling = input.toolAssembly.closeTooling;
    closeRuntime = input.toolAssembly.closeRuntime;
    const buildInstructions = input.buildInstructions ??
      (() =>
        buildHostedChildForkInstructions(
          input.resolveForkContext?.() ?? input.forkContext,
        ));
    const sourceInstrumentation = input.instrumentation;
    const sourceTrace = sourceInstrumentation?.trace;
    const traceTools = sourceTrace
      ? {
        trace: <TResult>(spanName: string, operation: () => TResult): TResult =>
          sourceTrace(spanName, operation),
        buildAttributes: sourceInstrumentation.buildToolTraceAttributes,
        setAttributes: sourceInstrumentation.setTraceAttributes,
      }
      : undefined;
    const startRuntime = input.startRuntime ?? startHostedChildForkRuntimeWithHostTools;
    const started = await startRuntime({
      apiUrl: input.apiUrl,
      authToken: input.authToken,
      projectId: input.projectId ?? null,
      ...(input.projectSlug ? { projectSlug: input.projectSlug } : {}),
      ...(input.resolveStepContext ? { resolveStepContext: input.resolveStepContext } : {}),
      provider: input.provider,
      forkModel: input.forkModel,
      temperature: input.temperature,
      maxSteps: input.maxSteps,
      prompt: input.effectivePrompt,
      maxContinuationSteps: input.maxContinuationSteps ?? 0,
      abortSignal: input.abortSignal,
      forkTools: input.toolAssembly.forkTools,
      forkToolNames: input.toolAssembly.availableToolNames,
      sourceIntegrationPolicy: input.sourceIntegrationPolicy,
      providerOptions: input.providerOptions,
      reasoning: input.reasoning,
      buildInstructions,
      onBeforeStop: input.onBeforeStop ?? (() => null),
      durableChildRun: input.durableChildRun,
      childRunMonitorPollIntervalMs: input.childRunMonitorPollIntervalMs ??
        DEFAULT_HOSTED_CHILD_STATUS_POLL_INTERVAL_MS,
      logger: input.logger?.warn ? { warn: input.logger.warn } : undefined,
      prepareStep: ({ messages, buildInstructions: prepareBuildInstructions, forkToolNames }) =>
        prepareHostedChildForkRuntimeStepMessages({
          messages,
          buildInstructions: prepareBuildInstructions,
          forkToolNames,
          resolveSystem: input.resolveSystem ?? defaultResolveSystem,
        }),
      runStep: input.runStep ?? runAgentRuntimeForkStep,
      traceTools,
    });
    childRunMonitorAbortController = started.childRunMonitorAbortController;
    childRunMonitorPromise = started.childRunMonitorPromise;

    return await executeHostedChildForkRunContextStream({
      runContext,
      streamResult: started.streamResult,
      abortSignal: input.abortSignal,
      abortForkStream: (error) => {
        if (!started.forkStreamAbortController.signal.aborted) {
          started.forkStreamAbortController.abort(error);
        }
      },
      conversationId: input.conversationId,
      parentRunId: input.parentRunId,
      description: input.description,
      kind: input.kind,
      usage: undefined,
      maxSteps: input.maxSteps,
      resultMode: input.resultMode,
      startTime,
      finalizationTimeoutMs: input.finalizationTimeoutMs ??
        DEFAULT_HOSTED_CHILD_FORK_STREAM_FINALIZATION_TIMEOUT_MS,
      onSettled: input.onSettled,
      idleTimeoutMs: input.idleTimeoutMs ?? DEFAULT_HOSTED_CHILD_FORK_STREAM_IDLE_TIMEOUT_MS,
      activeToolTimeoutMs: input.activeToolTimeoutMs ??
        DEFAULT_HOSTED_CHILD_FORK_STREAM_ACTIVE_TOOL_TIMEOUT_MS,
      postToolIdleTimeoutMs: input.postToolIdleTimeoutMs ??
        DEFAULT_HOSTED_CHILD_FORK_STREAM_POST_TOOL_IDLE_TIMEOUT_MS,
      logger: input.logger,
      writeLog: input.writeLog,
      tracePart: input.instrumentation?.tracePart,
    });
  } catch (error) {
    return handleHostedChildForkRunContextError({
      error,
      abortSignal: input.abortSignal,
      description: input.description,
      kind: input.kind,
      runContext,
      usage: undefined,
      startTime,
      onSettled: input.onSettled,
      shouldRethrowError: input.shouldRethrowError,
      writeLog: input.writeLog,
    });
  } finally {
    await finalizeHostedChildForkRunContextResources({
      runContext,
      monitorAbortController: childRunMonitorAbortController,
      monitorPromise: childRunMonitorPromise,
      flushMirror: async () => {
        await runContext.durableRunMirror?.flush();
      },
      closeTooling,
      closeRuntime,
    });
    closeTooling = undefined;
    closeRuntime = undefined;
  }
}
