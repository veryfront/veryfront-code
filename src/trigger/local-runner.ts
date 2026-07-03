import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform";
import type { VeryfrontConfig } from "#veryfront/config";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import { createWorkflowClient } from "#veryfront/workflow/api/workflow-client.ts";
import {
  discoverProjectTaskRuntime,
  findProjectRuntimeTask,
} from "#veryfront/task/project-runtime.ts";
import { runTask } from "#veryfront/task/runner.ts";
import type { TriggerTarget } from "./target.ts";

export interface RunTriggerTargetOptions {
  projectDir: string;
  adapter: RuntimeAdapter;
  config?: VeryfrontConfig;
  cacheKey?: string;
  projectId?: string;
  target: TriggerTarget;
  input?: unknown;
  debug?: boolean;
}

export interface TriggerTargetRunResult {
  kind: TriggerTarget["kind"];
  id: string;
  output?: unknown;
  durationMs: number;
}

function toRecordInput(input: unknown): Record<string, unknown> {
  if (input === undefined) return {};
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return { payload: input };
}

async function discoverRuntimeOrThrow(options: RunTriggerTargetOptions) {
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

async function runTaskTarget(options: RunTriggerTargetOptions): Promise<TriggerTargetRunResult> {
  const discovery = await discoverRuntimeOrThrow(options);
  const task = findProjectRuntimeTask(discovery, options.target.id);
  if (!task) {
    throw new Error(`Task target "${options.target.id}" not found.`);
  }

  const result = await runTask({
    task,
    config: toRecordInput(options.input),
    projectId: options.projectId,
    debug: options.debug,
  });

  if (!result.success) {
    throw new Error(result.error ?? `Task target "${options.target.id}" failed.`);
  }

  return {
    kind: "task",
    id: options.target.id,
    output: result.result,
    durationMs: result.durationMs,
  };
}

async function runWorkflowTarget(
  options: RunTriggerTargetOptions,
): Promise<TriggerTargetRunResult> {
  const start = Date.now();
  const discovery = await discoverRuntimeOrThrow(options);

  const workflow = discovery.workflows.get(options.target.id);
  if (!workflow) {
    throw new Error(`Workflow target "${options.target.id}" not found.`);
  }

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
    const handle = await client.start(options.target.id, options.input ?? {});
    const output = await handle.result();
    return {
      kind: "workflow",
      id: options.target.id,
      output,
      durationMs: Date.now() - start,
    };
  } finally {
    await client.destroy();
  }
}

export async function runTriggerTarget(
  options: RunTriggerTargetOptions,
): Promise<TriggerTargetRunResult> {
  if (options.target.kind === "task") {
    return await runTaskTarget(options);
  }

  if (options.target.kind === "workflow") {
    return await runWorkflowTarget(options);
  }

  throw new Error(
    "Agent trigger targets are Cloud-only for this milestone. Use a workflow or task for local trigger runs.",
  );
}
