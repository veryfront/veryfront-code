import { cliLogger } from "#cli/utils";
import { exitProcess } from "#cli/utils";
import { withProjectSourceContext } from "#cli/shared/project-source-context";
import { sanitizeJobOutputForLogging } from "../../utils/sanitize-job-output.ts";
import { writeJobResultIfConfigured } from "../../utils/write-job-result.ts";
import { getEnv } from "veryfront/platform";
import type { WorkflowArgs } from "./handler.ts";

const WORKFLOW_STATUS_POLL_INTERVAL_MS = 1_000;

export interface WorkflowOptions extends WorkflowArgs {}

async function createWorkflowClient(debug: boolean) {
  const { createWorkflowClient } = await import(
    "../../../src/workflow/api/workflow-client.ts"
  );

  const redisUrl = getEnv("REDIS_URL")?.trim();
  if (!redisUrl) {
    return createWorkflowClient({ debug });
  }

  const { RedisBackend } = await import(
    "../../../src/workflow/backends/redis.ts"
  );

  const backend = new RedisBackend({ url: redisUrl, debug });
  if (backend.initialize) {
    await backend.initialize();
  }

  return createWorkflowClient({ backend, debug });
}

async function waitForWorkflowExit(
  client: Awaited<ReturnType<typeof createWorkflowClient>>,
  runId: string,
): Promise<void> {
  while (true) {
    const run = await client.getRun(runId);
    if (!run) {
      throw new Error(`Workflow run not found: ${runId}`);
    }

    if (run.status === "completed") {
      cliLogger.info(`Workflow completed: ${runId}`);
      if (run.output !== undefined) {
        await writeJobResultIfConfigured(run.output);
        cliLogger.info(
          `Result: ${JSON.stringify(sanitizeJobOutputForLogging(run.output), null, 2)}`,
        );
      }
      return;
    }

    if (run.status === "waiting") {
      cliLogger.info(`Workflow is waiting: ${runId}`);
      return;
    }

    if (run.status === "failed") {
      throw new Error(run.error?.message || `Workflow failed: ${runId}`);
    }

    if (run.status === "cancelled") {
      throw new Error(`Workflow was cancelled: ${runId}`);
    }

    await new Promise((resolve) => setTimeout(resolve, WORKFLOW_STATUS_POLL_INTERVAL_MS));
  }
}

export async function workflowCommand(options: WorkflowOptions): Promise<void> {
  if (options.action !== "run") {
    cliLogger.error(`Unknown workflow action: ${options.action}`);
    exitProcess(1);
    return;
  }

  const workflowId = options.name;
  if (!workflowId) {
    cliLogger.error("Workflow ID is required. Usage: veryfront workflow run <id>");
    exitProcess(1);
    return;
  }

  let input: Record<string, unknown> = {};
  if (options.input) {
    try {
      input = JSON.parse(options.input);
    } catch {
      cliLogger.error("Invalid --input JSON");
      exitProcess(1);
      return;
    }
  }

  const { discoverWorkflows } = await import(
    "../../../src/workflow/discovery/index.ts"
  );

  await withProjectSourceContext(Deno.cwd(), async ({ adapter, config, proxyContext }) => {
    const sourceLabel = proxyContext?.branchRef
      ? `branch ${proxyContext.branchRef}`
      : proxyContext
      ? "main"
      : `${Deno.cwd()}/app/workflows/...`;

    cliLogger.info(`Discovering workflows in ${sourceLabel}`);

    const discovery = await discoverWorkflows({
      projectDir: Deno.cwd(),
      adapter,
      config,
      debug: options.debug,
    });

    if (discovery.errors.length > 0 && options.debug) {
      for (const err of discovery.errors) {
        cliLogger.warn(`  Warning: ${err.filePath}: ${err.error}`);
      }
    }

    const workflow = discovery.workflows.find((candidate) => candidate.id === workflowId);
    if (!workflow) {
      cliLogger.error(`Workflow "${workflowId}" not found.`);
      if (discovery.workflows.length > 0) {
        cliLogger.info("Available workflows:");
        for (const candidate of discovery.workflows) {
          cliLogger.info(`  - ${candidate.id}`);
        }
      } else {
        cliLogger.info("No workflows found. Create a workflow file in app/workflows/.");
      }
      exitProcess(1);
      return;
    }

    const client = await createWorkflowClient(options.debug);

    try {
      client.register(workflow.definition);
      cliLogger.info(`Running workflow: ${workflow.id}`);
      cliLogger.info("");

      const handle = await client.start(workflow.id, input);
      await waitForWorkflowExit(client, handle.runId);
    } finally {
      await client.destroy();
    }
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    cliLogger.error(message);
    exitProcess(1);
  });
}
