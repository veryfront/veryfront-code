import { cliLogger } from "#cli/utils";
import { INVALID_ARGUMENT, RESOURCE_NOT_FOUND } from "veryfront/errors";
import {
  orchestrateExtensions as orchestrateProjectExtensions,
  type OrchestrateOptions,
} from "veryfront/extensions";
import { withProjectSourceContext } from "#cli/shared/project-source-context";
import { agentRegistry } from "../../../src/agent/composition/index.ts";
import {
  discoverProjectAgentRuntime,
  type ProjectAgentRuntimeDiscovery,
  runWithProjectAgentRuntime,
} from "../../../src/agent/project/agent-runtime.ts";
import { toolRegistry } from "../../../src/tool/registry.ts";
import type { WorkflowClientConfig } from "../../../src/workflow/api/workflow-client.ts";
import type { WorkflowBackend } from "../../../src/workflow/backends/types.ts";
import { sanitizeRunOutputForLogging } from "../../utils/sanitize-run-output.ts";
import { writeRunResultIfConfigured } from "../../utils/write-run-result.ts";
import type { WorkflowArgs } from "./handler.ts";

const WORKFLOW_STATUS_POLL_INTERVAL_MS = 1_000;
const MAX_DISCOVERY_ERRORS_TO_PRINT = 5;

export interface WorkflowOptions extends Omit<WorkflowArgs, "backend"> {
  backend?: WorkflowArgs["backend"];
  projectDir?: string;
}

interface ExtensionLifecycle {
  teardownAll(): Promise<void>;
}

type WorkflowExtensionOrchestrator = (
  options: OrchestrateOptions,
) => Promise<ExtensionLifecycle>;

type DistributedWorkflowBackendFactory = (
  options: { debug?: boolean },
) => WorkflowBackend;

export interface WorkflowCommandDependencies {
  discoverProjectAgentRuntime?: typeof discoverProjectAgentRuntime;
  orchestrateExtensions?: WorkflowExtensionOrchestrator;
  createDistributedWorkflowBackend?: DistributedWorkflowBackendFactory;
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
  return createWorkflowClient(clientConfig);
}

async function runWithCleanup<T>(
  run: () => Promise<T>,
  cleanup: () => Promise<void>,
  combinedFailureMessage: string,
): Promise<T> {
  const outcome = await run().then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

  try {
    await cleanup();
  } catch (cleanupError) {
    if (!outcome.ok) {
      throw new AggregateError(
        [outcome.error, cleanupError],
        combinedFailureMessage,
      );
    }
    throw cleanupError;
  }

  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

async function createSelectedWorkflowBackend(
  selection: WorkflowArgs["backend"],
  debug: boolean,
  dependencies: WorkflowCommandDependencies,
): Promise<WorkflowBackend | undefined> {
  if (selection === "memory") return undefined;

  const createBackend = dependencies.createDistributedWorkflowBackend ??
    (await import("../../../src/workflow/backends/distributed.ts"))
      .createDistributedWorkflowBackend;
  const backend = createBackend({ debug });

  try {
    await backend.initialize?.();
    return backend;
  } catch (initializationError) {
    try {
      await backend.destroy();
    } catch (cleanupError) {
      throw new AggregateError(
        [initializationError, cleanupError],
        "Distributed workflow backend initialization and cleanup failed",
      );
    }
    throw initializationError;
  }
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
    throw INVALID_ARGUMENT.create({
      detail: `Unknown workflow action: ${options.action}. Supported actions: run`,
    });
  }

  const workflowId = options.name;
  if (!workflowId) {
    throw INVALID_ARGUMENT.create({
      detail: "Workflow ID is required. Usage: veryfront workflow run <id>",
    });
  }

  let input: Record<string, unknown> = {};
  if (options.input) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(options.input);
    } catch {
      throw INVALID_ARGUMENT.create({
        detail: "Invalid --input JSON: must be a valid JSON object",
      });
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw INVALID_ARGUMENT.create({
        detail: "Invalid --input JSON: must be a valid JSON object",
      });
    }
    input = parsed as Record<string, unknown>;
  }

  const projectDir = options.projectDir ?? Deno.cwd();

  const discoverRuntime: (
    input: Parameters<typeof discoverProjectAgentRuntime>[0],
  ) => Promise<ProjectAgentRuntimeDiscovery> = dependencies.discoverProjectAgentRuntime ??
    discoverProjectAgentRuntime;

  await withProjectSourceContext(projectDir, async (context) => {
    const { adapter, config, configCacheKey, proxyContext } = context;
    const orchestrateExtensions = dependencies.orchestrateExtensions ??
      orchestrateProjectExtensions;
    const extensionLoader = await orchestrateExtensions({
      projectDir,
      config,
      logger: cliLogger,
    });

    await runWithCleanup(
      async () => {
        const sourceLabel = proxyContext?.branchRef
          ? `branch ${proxyContext.branchRef}`
          : proxyContext
          ? "main"
          : `${projectDir}/workflows/...`;

        cliLogger.info(`Discovering workflows in ${sourceLabel}`);

        const discovery = await discoverRuntime({
          projectDir,
          adapter,
          config,
          fsAdapter: adapter.fs,
          cacheKey: configCacheKey,
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
          throw RESOURCE_NOT_FOUND.create({ detail: `Workflow "${workflowId}" not found.` });
        }

        await runWithProjectAgentRuntime(discovery, async () => {
          const backend = await createSelectedWorkflowBackend(
            options.backend ?? "memory",
            options.debug,
            dependencies,
          );
          let client: Awaited<ReturnType<typeof createWorkflowClient>> | undefined;

          await runWithCleanup(
            async () => {
              const activeClient = await createWorkflowClient({
                debug: options.debug,
                ...(backend ? { backend } : {}),
              });
              client = activeClient;
              activeClient.register(workflow.definition);
              cliLogger.info(`Running workflow: ${workflow.id}`);
              cliLogger.info("");

              const handle = await activeClient.start(workflow.id, input);
              await runWithCleanup(
                () => waitForWorkflowExit(activeClient, handle.runId),
                () => handle.settled(),
                "Workflow status observation and execution settlement failed",
              );
            },
            async () => {
              if (client) await client.destroy();
              else if (backend) await backend.destroy();
            },
            "Workflow execution and backend cleanup failed",
          );
        });
      },
      () => extensionLoader.teardownAll(),
      "Workflow command and extension teardown failed",
    );
  });
}
