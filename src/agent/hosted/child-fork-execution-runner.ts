import type { HostToolTraceAttributes } from "#veryfront/tool";
import type { AgentSystem } from "#veryfront/agent/types.ts";
import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
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
import {
  getActiveHostedRunEventWriterCapability,
  type HostedRunEventWriterCapability,
  runWithHostedRunEventWriterCapability,
} from "./child-run-event-writer-token.ts";
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
  requireConfirmedHostedProjectReference,
  resolveHostedProjectReference,
} from "./project-reference-resolver.ts";
import { runWithMandatoryRunEventSink } from "../../runtime/run-event-sink-context.ts";
import {
  createDurableRunEventSink,
  DurableRunEventPersistenceError,
} from "./durable-run-event-sink.ts";

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
  /** Exact-child durable event-writer authority. */
  runEventWriterCapability?: HostedRunEventWriterCapability;
  durableChildRun?: HostedChildRunIdentifiers;
  conversationId?: string;
  parentRunId?: string;
  description: string;
  instrumentation?: HostedChildForkExecutionInstrumentation<TAttributes>;
  pendingToolLogWriter?: { warn: (message: string, metadata?: Record<string, unknown>) => void };
};

/**
 * Input for a hosted child fork whose tools are already prepared.
 * Durable execution requires a capability bound to `durableChildRun.childRunId`.
 */
export type ExecuteHostedChildForkWithPreparedToolsInput<
  TAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
> = {
  authToken: string;
  apiUrl: string;
  /** Exact-child authority required when `durableChildRun` is present. */
  runEventWriterCapability?: HostedRunEventWriterCapability;
  projectId?: string | null;
  description: string;
  kind: string;
  provider: string;
  forkModel: string;
  temperature?: number;
  maxSteps: number;
  effectivePrompt: string;
  forkContext?: HostedChildForkInstructionsContext;
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
  buildInstructions?: () => AgentSystem;
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
    runEventWriterCapability: input.runEventWriterCapability,
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
  structuredSystem?: readonly ChatSystemMessage[];
  compactedMessages: Parameters<HostedChildForkRuntimeStepSystemResolver>[0]["compactedMessages"];
}): AgentSystem {
  const currentSystem: AgentSystem = input.structuredSystem
    ? [...input.structuredSystem]
    : input.system;
  if (!shouldReinforceLoadSkillContinuation([...input.compactedMessages])) {
    return currentSystem;
  }

  return addLoadSkillContinuationReminder(currentSystem);
}

/**
 * Options for executing a hosted child-fork tool input.
 * When `durableChildRun` is present, `runEventWriterCapability` must carry
 * exact-child authority; parent and sibling capabilities fail before dispatch.
 */
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
    onRequestedProjectId?: (projectId: string, projectSlug?: string) => void | Promise<void>;
    resolveProjectReference?: HostedProjectReferenceResolver;
    prepareToolAssembly: (input: {
      runtimeConfig: HostedChildForkRuntimeConfig;
      requestedTools?: HostedChildForkToolInput["tools"];
      abortSignal?: AbortSignal;
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

async function executeHostedChildForkToolInputWithoutWriterAuthority<
  TAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
>(
  input: ExecuteHostedChildForkToolInputOptions<TAttributes>,
  runEventWriterCapability: HostedRunEventWriterCapability | undefined,
): Promise<ChildRunExecutionResult> {
  const requestedProjectReference = input.forkInput.project_reference;
  if (requestedProjectReference) {
    const resolver = input.resolveProjectReference ?? resolveHostedProjectReference;
    const resolution = await resolver({
      projectReference: requestedProjectReference,
      authToken: input.authToken,
      apiUrl: input.apiUrl,
      abortSignal: input.abortSignal,
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

  const toolAssembly = await runWithHostedRunEventWriterCapability(
    runEventWriterCapability,
    () =>
      input.prepareToolAssembly({
        runtimeConfig,
        requestedTools: runtimeConfig.requestedTools,
        abortSignal: input.abortSignal,
      }),
  );

  return executeHostedChildForkWithPreparedTools({
    ...input,
    runEventWriterCapability,
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

/** Input payload for execute hosted child fork tool. */
export async function executeHostedChildForkToolInput<
  TAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
>(
  input: ExecuteHostedChildForkToolInputOptions<TAttributes>,
): Promise<ChildRunExecutionResult> {
  const runEventWriterCapability = input.runEventWriterCapability ??
    getActiveHostedRunEventWriterCapability();

  return await runWithHostedRunEventWriterCapability(
    undefined,
    () => executeHostedChildForkToolInputWithoutWriterAuthority(input, runEventWriterCapability),
  );
}

async function executeHostedChildForkWithoutWriterAuthority<
  TAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
>(
  input: ExecuteHostedChildForkWithPreparedToolsInput<TAttributes>,
  runContext: HostedDurableChildForkRunContext,
  startTime: number,
): Promise<ChildRunExecutionResult> {
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

    const toolAssembly = input.toolAssembly;

    closeTooling = toolAssembly.closeTooling;
    closeRuntime = toolAssembly.closeRuntime;
    const buildInstructions = input.buildInstructions ??
      (() => buildHostedChildForkInstructions(input.forkContext));
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
    if (input.durableChildRun && !runContext.durableRunMirror) {
      throw new DurableRunEventPersistenceError(
        "Durable hosted child run requires an event mirror",
      );
    }
    const startupRunEventSink = runContext.durableRunMirror
      ? createDurableRunEventSink({
        mirror: runContext.durableRunMirror,
        abortSignal: input.abortSignal,
      })
      : undefined;
    const start = () =>
      startRuntime({
        apiUrl: input.apiUrl,
        authToken: input.authToken,
        projectId: input.projectId ?? null,
        provider: input.provider,
        forkModel: input.forkModel,
        temperature: input.temperature,
        maxSteps: input.maxSteps,
        prompt: input.effectivePrompt,
        maxContinuationSteps: input.maxContinuationSteps ?? 0,
        abortSignal: input.abortSignal,
        forkTools: toolAssembly.forkTools,
        forkToolNames: toolAssembly.availableToolNames,
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
            providerOptionKey: input.provider,
            resolveSystem: input.resolveSystem ?? defaultResolveSystem,
          }),
        runStep: input.runStep ?? runAgentRuntimeForkStep,
        traceTools,
      });
    const started = await (startupRunEventSink
      ? runWithMandatoryRunEventSink(startupRunEventSink, start)
      : start());
    childRunMonitorAbortController = started.childRunMonitorAbortController;
    childRunMonitorPromise = started.childRunMonitorPromise;
    const streamAbortSignal = input.abortSignal
      ? AbortSignal.any([input.abortSignal, started.forkStreamAbortController.signal])
      : started.forkStreamAbortController.signal;
    const runEventSink = runContext.durableRunMirror
      ? createDurableRunEventSink({
        mirror: runContext.durableRunMirror,
        abortSignal: streamAbortSignal,
      })
      : undefined;

    const consume = () =>
      executeHostedChildForkRunContextStream({
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
    return await (runEventSink ? runWithMandatoryRunEventSink(runEventSink, consume) : consume());
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

/** Execute hosted child fork with prepared tools. */
export async function executeHostedChildForkWithPreparedTools<
  TAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
>(
  input: ExecuteHostedChildForkWithPreparedToolsInput<TAttributes>,
): Promise<ChildRunExecutionResult> {
  const startTime = input.startTime ?? Date.now();
  const runEventWriterCapability = input.runEventWriterCapability ??
    getActiveHostedRunEventWriterCapability();
  const runContextInput = {
    authToken: input.authToken,
    apiUrl: input.apiUrl,
    ...(runEventWriterCapability ? { runEventWriterCapability } : {}),
    durableChildRun: input.durableChildRun,
    conversationId: input.conversationId,
    parentRunId: input.parentRunId,
    description: input.description,
    instrumentation: input.instrumentation,
    pendingToolLogWriter: input.pendingToolLogWriter,
  };
  const runContext = runWithHostedRunEventWriterCapability(
    runEventWriterCapability,
    () =>
      input.createRunContext
        ? input.createRunContext(runContextInput)
        : createForkRunContext(runContextInput),
  );

  return await runWithHostedRunEventWriterCapability(
    undefined,
    () => executeHostedChildForkWithoutWriterAuthority(input, runContext, startTime),
  );
}
