import { NOT_SUPPORTED, RESOURCE_NOT_FOUND, TIMEOUT_ERROR } from "#veryfront/errors";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { findProjectRuntimeTask } from "#veryfront/task/project-runtime.ts";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import { createWorkflowClient, RedisBackend } from "#veryfront/workflow";
import type { WorkflowClientConfig } from "#veryfront/workflow";
import type { HandlerContext } from "../types.ts";
import type {
  ProjectRunExecuteHandlerDeps,
  ProjectRunExecuteRequest,
  ProjectRunExecuteResponse,
  WorkflowClientView,
  WorkflowRunView,
} from "./project-run-types.ts";

const WORKFLOW_STATUS_POLL_INTERVAL_MS = 100;
const WORKFLOW_STATUS_TIMEOUT_MS = 15 * 60 * 1_000;
const WORKFLOW_PERSISTENCE_REQUIRED_ERROR =
  "Workflow paused but runtime workflow persistence is not configured";

function withRuntimeStepRegistries(config?: WorkflowClientConfig): WorkflowClientConfig {
  return {
    ...config,
    executor: {
      ...config?.executor,
      stepExecutor: {
        ...config?.executor?.stepExecutor,
        agentRegistry: config?.executor?.stepExecutor?.agentRegistry ?? agentRegistry,
        toolRegistry: config?.executor?.stepExecutor?.toolRegistry ?? toolRegistry,
      },
    },
  };
}

export async function createRuntimeWorkflowClient(
  config?: WorkflowClientConfig,
): Promise<WorkflowClientView> {
  const clientConfig = withRuntimeStepRegistries(config);
  const redisUrl = getHostEnv("REDIS_URL")?.trim();
  if (!redisUrl) {
    return Object.assign(createWorkflowClient(clientConfig), {
      statePersistence: "ephemeral" as const,
    });
  }

  const backend = new RedisBackend({ url: redisUrl, debug: config?.debug });
  await backend.initialize?.();
  return Object.assign(createWorkflowClient({ ...clientConfig, backend, debug: config?.debug }), {
    statePersistence: "durable" as const,
  });
}

export async function executeLocalTaskRun(
  request: ProjectRunExecuteRequest,
  ctx: HandlerContext,
  deps: ProjectRunExecuteHandlerDeps,
): Promise<ProjectRunExecuteResponse> {
  const taskId = request.target.slice("task:".length);
  if (taskId === "knowledge-ingest") {
    throw NOT_SUPPORTED.create({
      detail: "Knowledge ingest must be executed through the knowledge ingest executor",
    });
  }

  const discovery = await deps.ensureProjectDiscovery(ctx);
  const task = findProjectRuntimeTask(discovery, taskId);
  if (!task) {
    return {
      success: false,
      error: `Task not found: ${taskId}`,
      logs: null,
      duration_ms: 0,
    };
  }

  const result = await deps.runTask({
    task,
    config: request.config ?? {},
    projectId: request.projectId,
    environmentId: request.runtimeTargetEnvironmentId === undefined
      ? ctx.environmentId
      : request.runtimeTargetEnvironmentId ?? undefined,
    debug: ctx.debug,
  });
  return {
    success: result.success,
    result: result.result,
    error: result.error,
    duration_ms: result.durationMs,
    logs: null,
  };
}

async function waitForWorkflowResult(
  client: WorkflowClientView,
  runId: string,
  deps: ProjectRunExecuteHandlerDeps,
): Promise<WorkflowRunView> {
  const deadline = deps.now() + WORKFLOW_STATUS_TIMEOUT_MS;
  while (true) {
    const run = await client.getRun(runId);
    if (!run) throw RESOURCE_NOT_FOUND.create({ detail: `Workflow run not found: ${runId}` });
    if (["completed", "failed", "cancelled", "waiting"].includes(run.status)) return run;
    if (deps.now() >= deadline) {
      throw TIMEOUT_ERROR.create({ detail: `Workflow run timed out: ${runId}` });
    }
    await deps.sleep(WORKFLOW_STATUS_POLL_INTERVAL_MS);
  }
}

export async function executeLocalWorkflowRun(
  request: ProjectRunExecuteRequest,
  ctx: HandlerContext,
  deps: ProjectRunExecuteHandlerDeps,
): Promise<ProjectRunExecuteResponse> {
  const startedAt = deps.now();
  const workflowId = request.target.slice("workflow:".length);
  await deps.ensureProjectDiscovery(ctx);
  const workflow = await deps.findWorkflowById(workflowId, {
    projectDir: ctx.projectDir,
    adapter: ctx.adapter,
    config: ctx.config,
    debug: ctx.debug,
  });
  if (!workflow) {
    return {
      success: false,
      error: `Workflow not found: ${workflowId}`,
      logs: null,
      duration_ms: 0,
    };
  }

  const client = await deps.createWorkflowClient(withRuntimeStepRegistries({ debug: ctx.debug }));
  try {
    client.register(workflow.definition);
    const handle = await client.start(workflow.id, request.input ?? {}, { runId: request.runId });
    const run = await waitForWorkflowResult(client, handle.runId, deps);
    await handle.settled?.();
    const durationMs = Math.max(0, deps.now() - startedAt);

    if (run.status === "waiting" && client.statePersistence !== "durable") {
      return {
        success: false,
        error: WORKFLOW_PERSISTENCE_REQUIRED_ERROR,
        logs: null,
        duration_ms: durationMs,
      };
    }
    if (run.status === "waiting" || run.status === "completed") {
      return { success: true, result: run.output, logs: null, duration_ms: durationMs };
    }
    return {
      success: false,
      result: run.output,
      error: run.error?.message ?? `Workflow ended with status: ${run.status}`,
      logs: null,
      duration_ms: durationMs,
    };
  } finally {
    await client.destroy();
  }
}
