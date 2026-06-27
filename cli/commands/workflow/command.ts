import { cliLogger } from "#cli/utils";
import { exitProcess } from "#cli/utils";
import { withProjectSourceContext } from "#cli/shared/project-source-context";
import { agentRegistry } from "../../../src/agent/composition/index.ts";
import { discoverProjectAgentRuntime } from "../../../src/agent/project/agent-runtime.ts";
import type { DiscoveryResult } from "../../../src/discovery/types.ts";
import { toolRegistry } from "../../../src/tool/registry.ts";
import type { WorkflowClientConfig } from "../../../src/workflow/api/workflow-client.ts";
import { sanitizeRunOutputForLogging } from "../../utils/sanitize-run-output.ts";
import { writeRunResultIfConfigured } from "../../utils/write-run-result.ts";
import { getEnv } from "veryfront/platform";
import type { WorkflowArgs } from "./handler.ts";

const WORKFLOW_STATUS_POLL_INTERVAL_MS = 1_000;
const MAX_DISCOVERY_ERRORS_TO_PRINT = 5;

export interface WorkflowOptions extends WorkflowArgs {
  projectDir?: string;
}

interface WorkflowCommandDependencies {
  discoverProjectAgentRuntime?: typeof discoverProjectAgentRuntime;
}

export interface WorkflowDiscoveryError {
  filePath: string;
  error: string;
}

export function formatWorkflowDiscoveryErrors(
  errors: WorkflowDiscoveryError[],
): string[] {
  const visibleErrors = errors.slice(0, MAX_DISCOVERY_ERRORS_TO_PRINT);
  const lines = visibleErrors.map((err) => `  - ${err.filePath}: ${err.error}`);
  const hiddenCount = errors.length - visibleErrors.length;
  if (hiddenCount > 0) {
    lines.push(
      `  - ${hiddenCount} more workflow file${hiddenCount === 1 ? "" : "s"} failed to load`,
    );
  }
  return lines;
}

function formatRuntimeDiscoveryError(
  error: { file: string; error: Error },
): WorkflowDiscoveryError {
  return {
    filePath: error.file,
    error: error.error.message,
  };
}

function withProjectStepRegistries(config: WorkflowClientConfig): WorkflowClientConfig {
  return {
    ...config,
    executor: {
      ...config.executor,
      stepExecutor: {
        ...config.executor?.stepExecutor,
        agentRegistry: config.executor?.stepExecutor?.agentRegistry ?? agentRegistry,
        toolRegistry: config.executor?.stepExecutor?.toolRegistry ?? toolRegistry,
      },
    },
  };
}

async function createWorkflowClient(config: WorkflowClientConfig) {
  const { createWorkflowClient } = await import(
    "../../../src/workflow/api/workflow-client.ts"
  );
  const clientConfig = withProjectStepRegistries(config);

  const redisUrl = getEnv("REDIS_URL")?.trim();
  if (!redisUrl) {
    return createWorkflowClient(clientConfig);
  }

  const { RedisBackend } = await import(
    "../../../src/workflow/backends/redis.ts"
  );

  const debug = clientConfig.debug ?? false;
  const backend = new RedisBackend({ url: redisUrl, debug });
  if (backend.initialize) {
    await backend.initialize();
  }

  return createWorkflowClient({ ...clientConfig, backend });
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
        await writeRunResultIfConfigured(run.output);
        cliLogger.info(
          `Result: ${JSON.stringify(sanitizeRunOutputForLogging(run.output), null, 2)}`,
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
  await runWorkflowCommand(options);
}

export async function runWorkflowCommand(
  options: WorkflowOptions,
  dependencies: WorkflowCommandDependencies = {},
): Promise<void> {
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

  const projectDir = options.projectDir ?? Deno.cwd();

  const discoverRuntime: (
    input: Parameters<typeof discoverProjectAgentRuntime>[0],
  ) => Promise<DiscoveryResult> = dependencies.discoverProjectAgentRuntime ??
    discoverProjectAgentRuntime;

  await withProjectSourceContext(projectDir, async ({ adapter, proxyContext }) => {
    const sourceLabel = proxyContext?.branchRef
      ? `branch ${proxyContext.branchRef}`
      : proxyContext
      ? "main"
      : `${projectDir}/workflows/...`;

    cliLogger.info(`Discovering workflows in ${sourceLabel}`);

    const discovery = await discoverRuntime({
      projectDir,
      adapter,
      verbose: options.debug,
    });

    const workflows = [...discovery.workflows.values()];

    if (discovery.errors.length > 0 && options.debug) {
      for (const err of discovery.errors.map(formatRuntimeDiscoveryError)) {
        cliLogger.warn(`  Warning: ${err.filePath}: ${err.error}`);
      }
    }

    const workflow = workflows.find((candidate) => candidate.id === workflowId);
    if (!workflow) {
      cliLogger.error(`Workflow "${workflowId}" not found.`);
      if (discovery.errors.length > 0 && !options.debug) {
        cliLogger.warn("Some workflow files could not be loaded:");
        const errors = discovery.errors.map(formatRuntimeDiscoveryError);
        for (const line of formatWorkflowDiscoveryErrors(errors)) {
          cliLogger.warn(line);
        }
      }
      if (workflows.length > 0) {
        cliLogger.info("Available workflows:");
        for (const candidate of workflows) {
          cliLogger.info(`  - ${candidate.id}`);
        }
      } else {
        cliLogger.info("No workflows found. Create a workflow file in workflows/.");
      }
      exitProcess(1);
      return;
    }

    const client = await createWorkflowClient({ debug: options.debug });

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
