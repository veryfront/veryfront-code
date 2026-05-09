import type { HostToolTraceAttributes } from "#veryfront/tool";
import { buildChildRunFailureResult } from "./child-run-execution-snapshot.ts";
import {
  createHostedDurableChildForkRunContext,
  executeHostedChildForkRunContextStream,
  finalizeHostedChildForkRunContextResources,
  handleHostedChildForkRunContextError,
  type HostedDurableChildForkRunContext,
} from "./hosted-child-fork-run-context.ts";
import { type DefaultHostedChildForkToolAssemblyResult } from "./hosted-child-requested-tools.ts";
import {
  addLoadSkillContinuationReminder,
  shouldReinforceLoadSkillContinuation,
} from "./conversation-delegation-policy.ts";
import {
  buildHostedChildForkInstructions,
  type HostedChildForkInstructionsContext,
} from "./hosted-child-fork-instructions.ts";
import {
  type HostedChildForkRuntimeStepSystemResolver,
  prepareHostedChildForkRuntimeStepMessages,
} from "./hosted-child-fork-step-message-preparation.ts";
import {
  type StartedHostedChildForkRuntime,
  startHostedChildForkRuntimeWithHostTools,
  type StartHostedChildForkRuntimeWithHostToolsInput,
} from "./hosted-child-fork-runtime-start.ts";
import { type AgentRuntimeForkStepRunner, runAgentRuntimeForkStep } from "./fork-runtime-stream.ts";
import type {
  ChildRunExecutionResult,
  ChildRunExecutionSnapshot,
} from "./child-run-execution-snapshot.ts";
import type { HostedConversationRunChunkMirrorInstrumentation } from "./conversation-run-chunk-mirror.ts";
import type { HostedChildExecutionLogEntry } from "./hosted-child-execution-logging.ts";
import type {
  HostedChildForkStreamLogger,
  HostedChildForkStreamTraceInput,
} from "./hosted-child-fork-stream-execution.ts";
import type { HostedChildRunIdentifiers } from "./hosted-child-status.ts";
import { throwIfChildRunAborted } from "./child-run-execution-support.ts";

export const DEFAULT_HOSTED_CHILD_FORK_STREAM_IDLE_TIMEOUT_MS = 45_000;
export const DEFAULT_HOSTED_CHILD_FORK_STREAM_ACTIVE_TOOL_TIMEOUT_MS = 5 * 60_000;
export const DEFAULT_HOSTED_CHILD_FORK_STREAM_POST_TOOL_IDLE_TIMEOUT_MS = 2 * 60_000;
export const DEFAULT_HOSTED_CHILD_FORK_STREAM_FINALIZATION_TIMEOUT_MS = 10_000;
export const DEFAULT_HOSTED_CHILD_STATUS_POLL_INTERVAL_MS = 2_000;

export type HostedChildForkExecutionInstrumentation<
  TAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
> = {
  trace?: <TResult>(operationName: string, operation: () => TResult) => TResult;
  setTraceAttributes?: (attributes: Record<string, unknown>) => void;
  buildToolTraceAttributes?: (input: {
    toolName: string;
    toolCallId: string | undefined;
  }) => TAttributes | undefined;
  tracePart?: (input: HostedChildForkStreamTraceInput) => void | Promise<void>;
  debug?: (message: string, metadata?: Record<string, unknown>) => void;
  warn?: (message: string, metadata?: Record<string, unknown>) => void;
  error?: (message: string, metadata?: Record<string, unknown>) => void;
};

export type HostedChildForkExecutionRunContextFactoryInput = {
  authToken: string;
  apiUrl: string;
  durableChildRun?: HostedChildRunIdentifiers;
  conversationId?: string;
  parentRunId?: string;
  description: string;
  instrumentation?: HostedChildForkExecutionInstrumentation;
  pendingToolLogWriter?: { warn: (message: string, metadata?: Record<string, unknown>) => void };
};

export type ExecuteHostedChildForkWithPreparedToolsInput<
  TAttributes extends HostToolTraceAttributes = HostToolTraceAttributes,
> = {
  authToken: string;
  apiUrl: string;
  projectId?: string | null;
  description: string;
  kind: string;
  provider: string;
  forkModel: string;
  maxSteps: number;
  effectivePrompt: string;
  forkContext?: HostedChildForkInstructionsContext;
  toolAssembly: DefaultHostedChildForkToolAssemblyResult;
  abortSignal?: AbortSignal;
  durableChildRun?: HostedChildRunIdentifiers;
  conversationId?: string;
  parentRunId?: string;
  pendingToolLogWriter?: { warn: (message: string, metadata?: Record<string, unknown>) => void };
  logger?: HostedChildForkStreamLogger;
  instrumentation?: HostedChildForkExecutionInstrumentation<TAttributes>;
  providerOptions?: Record<string, unknown>;
  maxContinuationSteps?: number;
  resolveSystem?: HostedChildForkRuntimeStepSystemResolver;
  buildInstructions?: () => string;
  onBeforeStop?: StartHostedChildForkRuntimeWithHostToolsInput<TAttributes>["onBeforeStop"];
  runStep?: AgentRuntimeForkStepRunner;
  createRunContext?: (
    input: HostedChildForkExecutionRunContextFactoryInput,
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
  onSettled?: (snapshot: ChildRunExecutionSnapshot) => void | Promise<void>;
  writeLog?: (entry: HostedChildExecutionLogEntry) => void;
  shouldRethrowError?: (error: unknown) => boolean;
};

function createForkRunContext(
  input: HostedChildForkExecutionRunContextFactoryInput,
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
    const started = await startRuntime({
      apiUrl: input.apiUrl,
      authToken: input.authToken,
      projectId: input.projectId ?? null,
      provider: input.provider,
      forkModel: input.forkModel,
      maxSteps: input.maxSteps,
      prompt: input.effectivePrompt,
      maxContinuationSteps: input.maxContinuationSteps ?? 0,
      abortSignal: input.abortSignal,
      forkTools: input.toolAssembly.forkTools,
      providerOptions: input.providerOptions,
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
      flushMirror: () => runContext.durableRunMirror?.flush() ?? Promise.resolve(),
      closeTooling,
      closeRuntime,
    });
    closeTooling = undefined;
    closeRuntime = undefined;
  }
}
