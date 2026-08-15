import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { runWithProjectAgentRuntime } from "#veryfront/agent/project/agent-runtime.ts";
import {
  TRIGGER_CONFIG_INVALID,
  TRIGGER_EXECUTION_FAILED,
  TRIGGER_TARGET_NOT_FOUND,
} from "#veryfront/errors";
import type { RuntimeAdapter } from "#veryfront/platform";
import type { VeryfrontConfig } from "#veryfront/config";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import type { WorkflowHandle } from "#veryfront/workflow";
import { createWorkflowClient } from "#veryfront/workflow/api/workflow-client.ts";
import {
  discoverProjectTaskRuntime,
  findProjectRuntimeTask,
} from "#veryfront/task/project-runtime.ts";
import { runTask } from "#veryfront/task/runner.ts";
import { sleep } from "#veryfront/utils/sleep.ts";
import {
  type ResolvedTriggerTarget,
  resolveTriggerTarget,
  type TriggerTarget,
  type TriggerTargetConfig,
} from "./target.ts";
import { snapshotSerializable } from "./validation.ts";

const WORKFLOW_STATUS_POLL_INTERVAL_MS = 1_000;

/** Options for one local trigger target execution. */
export interface RunTriggerTargetOptions {
  /** Project root used by unified runtime discovery. */
  projectDir: string;
  /** Runtime adapter used for project source and environment access. */
  adapter: RuntimeAdapter;
  /** Optional project configuration for virtual or local discovery. */
  config?: VeryfrontConfig;
  /** Optional cache namespace for isolated virtual projects. */
  cacheKey?: string;
  /** Project identifier exposed to task execution context. */
  projectId?: string;
  /** Canonical task, workflow, or agent reference to execute. */
  target: TriggerTargetConfig;
  /** Bounded JSON input supplied to tasks and workflows. */
  input?: unknown;
  /** Required prompt input for agent targets. */
  agentInput?: string;
  /** Optional bounded JSON object supplied as agent context. */
  agentContext?: Record<string, unknown>;
  /** Cooperative cancellation propagated through discovery and execution. */
  signal?: AbortSignal;
  /** Enable target runtime diagnostics. */
  debug?: boolean;
}

/** Successful local trigger target result. */
export interface TriggerTargetRunResult {
  /** Executed target kind. */
  kind: TriggerTarget["kind"];
  /** Canonical target identifier. */
  id: string;
  /** Target-specific result payload. */
  output?: unknown;
  /** Total trigger discovery and execution time measured with a monotonic clock. */
  durationMs: number;
}

type TriggerExecutionResult = Omit<TriggerTargetRunResult, "durationMs">;

interface NormalizedRunTriggerTargetOptions extends
  Omit<
    RunTriggerTargetOptions,
    "target"
  > {
  target: ResolvedTriggerTarget;
}

function invalidTriggerConfiguration(detail: string): never {
  throw TRIGGER_CONFIG_INVALID.create({ detail });
}

function elapsedMilliseconds(start: number): number {
  return Math.max(0, Math.round(performance.now() - start));
}

function snapshotInput(input: unknown, label: string): ReturnType<typeof snapshotSerializable> {
  return input === undefined ? {} : snapshotSerializable(input, label);
}

function toRecordInput(input: ReturnType<typeof snapshotSerializable>): Record<string, unknown> {
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    return input;
  }
  return { payload: input };
}

function snapshotAgentContext(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (context === undefined) return undefined;
  const snapshot = snapshotSerializable(context, "Agent trigger context");
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    invalidTriggerConfiguration("Agent trigger context must be a data-only JSON object.");
  }
  return snapshot;
}

async function discoverRuntimeOrThrow(options: NormalizedRunTriggerTargetOptions) {
  options.signal?.throwIfAborted();
  const discovery = await discoverProjectTaskRuntime({
    projectDir: options.projectDir,
    adapter: options.adapter,
    config: options.config,
    fsAdapter: options.adapter.fs,
    cacheKey: options.cacheKey,
    debug: options.debug,
    throwOnErrors: true,
    allowHostProjectCodeExecution: true,
  });
  options.signal?.throwIfAborted();
  return discovery;
}

async function runTaskTarget(
  options: NormalizedRunTriggerTargetOptions,
): Promise<TriggerExecutionResult> {
  const input = snapshotInput(options.input, "Task trigger input");
  const discovery = await discoverRuntimeOrThrow(options);
  const task = findProjectRuntimeTask(discovery, options.target.id);
  if (!task) {
    throw TRIGGER_TARGET_NOT_FOUND.create({
      detail: `Task target "${options.target.id}" not found.`,
      context: { targetId: options.target.id },
    });
  }

  const result = await runWithProjectAgentRuntime(
    discovery,
    () =>
      runTask({
        task,
        config: toRecordInput(input),
        projectId: options.projectId,
        signal: options.signal,
        debug: options.debug,
      }),
  );

  if (!result.success) {
    options.signal?.throwIfAborted();
    throw TRIGGER_EXECUTION_FAILED.create({
      detail: result.error ?? `Task target "${options.target.id}" failed.`,
      context: { targetId: options.target.id },
    });
  }

  return {
    kind: "task",
    id: options.target.id,
    output: result.result,
  };
}

async function runWorkflowTarget(
  options: NormalizedRunTriggerTargetOptions,
): Promise<TriggerExecutionResult> {
  const input = snapshotInput(options.input, "Workflow trigger input");
  const discovery = await discoverRuntimeOrThrow(options);

  const workflow = discovery.workflows.get(options.target.id);
  if (!workflow) {
    throw TRIGGER_TARGET_NOT_FOUND.create({
      detail: `Workflow target "${options.target.id}" not found.`,
      context: { targetId: options.target.id },
    });
  }

  return await runWithProjectAgentRuntime(discovery, async () => {
    options.signal?.throwIfAborted();
    const client = createWorkflowClient({
      debug: options.debug,
      executor: {
        stepExecutor: {
          agentRegistry,
          toolRegistry,
        },
      },
    });

    try {
      client.register(workflow.definition);
      options.signal?.throwIfAborted();
      const handle = await client.start(options.target.id, input);
      try {
        const output = await waitForWorkflowResult(handle, options.signal);
        await handle.settled();
        return {
          kind: "workflow",
          id: options.target.id,
          output,
        };
      } catch (error) {
        try {
          await cancelAndSettleActiveWorkflow(handle);
        } catch (cleanupError) {
          throw TRIGGER_EXECUTION_FAILED.create({
            detail:
              `Workflow target "${options.target.id}" failed and could not be settled cleanly.`,
            context: { targetId: options.target.id },
            cause: new AggregateError(
              [error, cleanupError],
              "Workflow execution and cleanup both failed",
            ),
          });
        }
        options.signal?.throwIfAborted();
        throw error;
      }
    } finally {
      await client.destroy();
    }
  });
}

async function waitForWorkflowResult(
  handle: WorkflowHandle,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  if (signal === undefined) {
    return await handle.result();
  }
  signal.throwIfAborted();

  while (true) {
    const status = await handle.status();
    signal.throwIfAborted();
    if (isTerminalWorkflowStatus(status.status)) {
      return await handle.result();
    }
    await sleep(WORKFLOW_STATUS_POLL_INTERVAL_MS, signal);
  }
}

function isTerminalWorkflowStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

async function cancelAndSettleActiveWorkflow(handle: WorkflowHandle): Promise<void> {
  const initialStatus = await handle.status();
  if (!isTerminalWorkflowStatus(initialStatus.status)) {
    try {
      await handle.cancel();
    } catch (error) {
      const currentStatus = await handle.status().catch(() => undefined);
      if (
        currentStatus === undefined ||
        !isTerminalWorkflowStatus(currentStatus.status)
      ) {
        throw error;
      }
    }
  }
  await handle.settled();
}

function summarizeAgentResponse(
  response: unknown,
): { text: string; status: "completed" | "error"; toolCalls: number } | null {
  if (typeof response !== "object" || response === null) return null;
  try {
    const textDescriptor = Reflect.getOwnPropertyDescriptor(response, "text");
    const statusDescriptor = Reflect.getOwnPropertyDescriptor(response, "status");
    const toolCallsDescriptor = Reflect.getOwnPropertyDescriptor(response, "toolCalls");
    if (
      !textDescriptor ||
      !("value" in textDescriptor) ||
      typeof textDescriptor.value !== "string" ||
      !statusDescriptor ||
      !("value" in statusDescriptor) ||
      (statusDescriptor.value !== "completed" && statusDescriptor.value !== "error") ||
      !toolCallsDescriptor ||
      !("value" in toolCallsDescriptor) ||
      !Array.isArray(toolCallsDescriptor.value)
    ) {
      return null;
    }
    const lengthDescriptor = Reflect.getOwnPropertyDescriptor(toolCallsDescriptor.value, "length");
    const toolCallCount = lengthDescriptor && "value" in lengthDescriptor
      ? lengthDescriptor.value
      : undefined;
    if (
      typeof toolCallCount !== "number" ||
      !Number.isSafeInteger(toolCallCount) ||
      toolCallCount < 0
    ) {
      return null;
    }
    return {
      text: textDescriptor.value,
      status: statusDescriptor.value,
      toolCalls: toolCallCount,
    };
  } catch {
    return null;
  }
}

async function runAgentTarget(
  options: NormalizedRunTriggerTargetOptions,
): Promise<TriggerExecutionResult> {
  const agentInput = options.agentInput;
  if (typeof agentInput !== "string") {
    invalidTriggerConfiguration(
      "Local agent trigger runs require an explicit agent input. The input must be a string.",
    );
  }

  const agentContext = snapshotAgentContext(options.agentContext);
  const discovery = await discoverRuntimeOrThrow(options);
  const agent = agentRegistry.get(options.target.id);
  if (!agent) {
    throw TRIGGER_TARGET_NOT_FOUND.create({
      detail: `Agent target "${options.target.id}" not found.`,
      context: { targetId: options.target.id },
    });
  }

  return await runWithProjectAgentRuntime(discovery, async () => {
    const response = await agent.generate({
      input: agentInput,
      ...(agentContext === undefined ? {} : { context: agentContext }),
      ...(options.signal === undefined ? {} : { abortSignal: options.signal }),
    });
    options.signal?.throwIfAborted();
    const summary = summarizeAgentResponse(response);
    if (summary === null) {
      throw TRIGGER_EXECUTION_FAILED.create({
        detail: `Agent target "${options.target.id}" returned an invalid response.`,
        context: { targetId: options.target.id },
      });
    }
    if (summary.status === "error") {
      throw TRIGGER_EXECUTION_FAILED.create({
        detail: `Agent target "${options.target.id}" failed.`,
        context: { targetId: options.target.id },
      });
    }

    return {
      kind: "agent",
      id: options.target.id,
      output: {
        text: summary.text,
        status: summary.status,
        toolCalls: summary.toolCalls,
      },
    };
  });
}

/**
 * Discover and execute one canonical task, workflow, or agent target.
 *
 * Inputs are copied into bounded JSON snapshots before asynchronous work
 * begins. A supplied signal is checked before discovery and propagated through
 * every supported target kind.
 */
export async function runTriggerTarget(
  options: RunTriggerTargetOptions,
): Promise<TriggerTargetRunResult> {
  const start = performance.now();
  options.signal?.throwIfAborted();
  const resolution = resolveTriggerTarget("Trigger target", options.target);
  if (resolution.target === undefined) {
    invalidTriggerConfiguration(resolution.detail);
  }
  const target = resolution.target;
  // A local run never reaches the hosted conversation store, so only
  // `existing` is refusable: `create_new` and `none` both mean "run
  // standalone here" and need no local handling.
  if (target.kind === "agent" && target.conversationMode === "existing") {
    invalidTriggerConfiguration(
      "Local agent trigger runs cannot attach to an existing cloud conversation.",
    );
  }
  const normalizedOptions: NormalizedRunTriggerTargetOptions = {
    ...options,
    target,
  };

  let result: TriggerExecutionResult;
  if (target.kind === "task") {
    result = await runTaskTarget(normalizedOptions);
  } else if (target.kind === "workflow") {
    result = await runWorkflowTarget(normalizedOptions);
  } else {
    result = await runAgentTarget(normalizedOptions);
  }

  return { ...result, durationMs: elapsedMilliseconds(start) };
}
