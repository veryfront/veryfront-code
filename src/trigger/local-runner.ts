import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { runWithProjectAgentRuntime } from "#veryfront/agent/project/agent-runtime.ts";
import {
  TRIGGER_CONFIG_INVALID,
  TRIGGER_EXECUTION_FAILED,
  TRIGGER_NOT_SUPPORTED,
  TRIGGER_TARGET_NOT_FOUND,
  VeryfrontError,
} from "#veryfront/errors";
import type { RuntimeAdapter } from "#veryfront/platform";
import type { VeryfrontConfig } from "#veryfront/config";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import { createWorkflowClient } from "#veryfront/workflow/api/workflow-client.ts";
import {
  discoverProjectTaskRuntime,
  findProjectRuntimeTask,
} from "#veryfront/task/project-runtime.ts";
import { runTask } from "#veryfront/task/runner.ts";
import { snapshotTriggerTarget, type TriggerTarget } from "./target.ts";
import { snapshotSerializable } from "./validation.ts";

/** Options for running one discovered trigger target in the local runtime. */
export interface RunTriggerTargetOptions {
  /** Project root used for runtime discovery. */
  projectDir: string;
  /** Runtime adapter used for discovery and execution. */
  adapter: RuntimeAdapter;
  /** Resolved Veryfront project configuration. */
  config?: VeryfrontConfig;
  /** Cache identity for project runtime discovery. */
  cacheKey?: string;
  /** Project identifier exposed to task execution context. */
  projectId?: string;
  /** Task, workflow, or agent target to start. */
  target: TriggerTarget;
  /** Bounded JSON input passed to the target. */
  input?: unknown;
  /** Enables supported diagnostic logging. */
  debug?: boolean;
}

/** Result returned after a local task or workflow target completes. */
export interface TriggerTargetRunResult {
  /** Runtime primitive category that ran. */
  kind: TriggerTarget["kind"];
  /** Canonical target identifier. */
  id: string;
  /** Target-specific return value. */
  output?: unknown;
  /** Monotonic execution duration in milliseconds. */
  durationMs: number;
}

interface NormalizedRunTriggerTargetOptions extends RunTriggerTargetOptions {
  target: TriggerTarget;
}

function invalidOptions(detail: string): never {
  throw TRIGGER_CONFIG_INVALID.create({ detail });
}

function readOwnOption(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") invalidOptions("Trigger run options are required.");
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) return undefined;
    if (!("value" in descriptor)) {
      invalidOptions(`Trigger run options.${key} must be a data property.`);
    }
    return descriptor.value;
  } catch (error) {
    if (error instanceof VeryfrontError) throw error;
    invalidOptions("Trigger run options could not be inspected safely.");
  }
}

function optionalBoundedString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" || value.length === 0 || value.length > 1_024 ||
    value.includes("\0")
  ) {
    invalidOptions(`${label} must be a bounded non-empty string.`);
  }
  return value;
}

function snapshotRunOptions(value: RunTriggerTargetOptions): NormalizedRunTriggerTargetOptions {
  const projectDir = readOwnOption(value, "projectDir");
  const adapter = readOwnOption(value, "adapter");
  const config = readOwnOption(value, "config");
  const cacheKey = optionalBoundedString(readOwnOption(value, "cacheKey"), "Trigger cacheKey");
  const projectId = optionalBoundedString(readOwnOption(value, "projectId"), "Trigger projectId");
  const target = snapshotTriggerTarget(readOwnOption(value, "target"));
  const rawInput = readOwnOption(value, "input");
  const debug = readOwnOption(value, "debug");

  if (
    typeof projectDir !== "string" || projectDir.length === 0 || projectDir.length > 4_096 ||
    projectDir.includes("\0")
  ) {
    invalidOptions("Trigger projectDir must be a bounded non-empty path.");
  }
  if (!adapter || typeof adapter !== "object") invalidOptions("Trigger adapter is required.");
  if (config !== undefined && (!config || typeof config !== "object")) {
    invalidOptions("Trigger config must be an object when provided.");
  }
  if (!target) {
    invalidOptions("Trigger target must specify a valid task, workflow, or agent id.");
  }
  if (debug !== undefined && typeof debug !== "boolean") {
    invalidOptions("Trigger debug must be a boolean when provided.");
  }

  const input = snapshotSerializable(rawInput, "Trigger input");
  return {
    projectDir,
    adapter: adapter as RuntimeAdapter,
    ...(config === undefined ? {} : { config: config as VeryfrontConfig }),
    ...(cacheKey === undefined ? {} : { cacheKey }),
    ...(projectId === undefined ? {} : { projectId }),
    target,
    ...(input === undefined ? {} : { input }),
    ...(debug === undefined ? {} : { debug }),
  };
}

function toRecordInput(input: unknown): Record<string, unknown> {
  if (input === undefined) return {};
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return { payload: input };
}

async function discoverRuntimeOrThrow(options: NormalizedRunTriggerTargetOptions) {
  return await discoverProjectTaskRuntime({
    projectDir: options.projectDir,
    adapter: options.adapter,
    config: options.config,
    fsAdapter: options.adapter.fs,
    cacheKey: options.cacheKey,
    debug: options.debug,
    throwOnErrors: true,
  });
}

async function runTaskTarget(
  options: NormalizedRunTriggerTargetOptions,
): Promise<TriggerTargetRunResult> {
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
        config: toRecordInput(options.input),
        projectId: options.projectId,
        debug: options.debug,
      }),
  );

  if (!result.success) {
    throw TRIGGER_EXECUTION_FAILED.create({
      detail: `Task target "${options.target.id}" failed.`,
      context: { targetId: options.target.id },
    });
  }

  if (!Number.isFinite(result.durationMs) || result.durationMs < 0) {
    throw TRIGGER_EXECUTION_FAILED.create({
      detail: `Task target "${options.target.id}" returned an invalid duration.`,
      context: { targetId: options.target.id },
    });
  }

  return {
    kind: "task",
    id: options.target.id,
    output: result.result,
    durationMs: result.durationMs,
  };
}

async function runWorkflowTarget(
  options: NormalizedRunTriggerTargetOptions,
): Promise<TriggerTargetRunResult> {
  const discovery = await discoverRuntimeOrThrow(options);

  const workflow = discovery.workflows.get(options.target.id);
  if (!workflow) {
    throw TRIGGER_TARGET_NOT_FOUND.create({
      detail: `Workflow target "${options.target.id}" not found.`,
      context: { targetId: options.target.id },
    });
  }

  const start = performance.now();
  return await runWithProjectAgentRuntime(discovery, async () => {
    const client = createWorkflowClient({
      debug: options.debug,
      executor: {
        stepExecutor: {
          agentRegistry,
          toolRegistry,
        },
      },
    });

    let result: TriggerTargetRunResult | undefined;
    let failure: VeryfrontError | undefined;
    try {
      client.register(workflow.definition);
      const handle = await client.start(
        options.target.id,
        options.input === undefined ? {} : options.input,
      );
      await handle.settled();
      const output = await handle.result();
      result = {
        kind: "workflow",
        id: options.target.id,
        output,
        durationMs: performance.now() - start,
      };
    } catch {
      failure = TRIGGER_EXECUTION_FAILED.create({
        detail: `Workflow target "${options.target.id}" failed.`,
        context: { targetId: options.target.id },
      });
    }

    try {
      await client.destroy();
    } catch {
      if (!failure) {
        failure = TRIGGER_EXECUTION_FAILED.create({
          detail: `Workflow target "${options.target.id}" could not release its runtime.`,
          context: { targetId: options.target.id },
        });
      }
    }

    if (failure) throw failure;
    if (!result) {
      throw TRIGGER_EXECUTION_FAILED.create({
        detail: `Workflow target "${options.target.id}" did not return a result.`,
        context: { targetId: options.target.id },
      });
    }
    return result;
  });
}

/** Run a validated task or workflow target through project runtime discovery. */
export async function runTriggerTarget(
  input: RunTriggerTargetOptions,
): Promise<TriggerTargetRunResult> {
  const options = snapshotRunOptions(input);
  if (options.target.kind === "task") {
    return await runTaskTarget(options);
  }

  if (options.target.kind === "workflow") {
    return await runWorkflowTarget(options);
  }

  throw TRIGGER_NOT_SUPPORTED.create({
    detail:
      "Agent trigger targets are Cloud-only for this milestone. Use a workflow or task for local trigger runs.",
  });
}
