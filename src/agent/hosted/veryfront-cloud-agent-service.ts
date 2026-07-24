import type { AgentServiceSandboxToolsOptions } from "#veryfront/sandbox";
import { agentLogger } from "#veryfront/utils";
import { __registerTraceContextGetter } from "../../utils/logger/logger.ts";
import {
  type BootstrapAgentServiceOptions,
  runAgentServiceMain,
  type RunAgentServiceMainOptions,
} from "../service/bootstrap.ts";
import { loadAgentServiceEnvFiles } from "../service/env-files.ts";
import type { AgentServiceMcpServerConfig } from "../service/mcp-server-config.ts";
import type { AgentVeryfrontMcpServerConfig } from "../types.ts";
import {
  type AgentServiceRuntimeBundle,
  createAgentServiceRuntime,
  startAgentServiceRuntime,
  startNodeAgentService,
  type StartNodeAgentServiceResult,
} from "../service/runtime.ts";
import type { CreateNodeAgentServiceRuntimeInfrastructureOptions } from "../service/node-runtime-infrastructure.ts";
import type { ProjectAgentRuntimeAgentSource } from "../project/agent-runtime.ts";
import type { HostedRuntimeSourceIdentity } from "./runtime-source-binding.ts";
import { resolveDefaultProcessTarget } from "./cloud-agent-paths.ts";
import { resolveNodeVeryfrontCloudAgentServiceOptions } from "./cloud-agent-provider-bootstrap.ts";
import {
  createNodeVeryfrontCloudAgentServiceContext,
  initializeNodeVeryfrontCloudAgentServiceContext,
} from "./cloud-agent-config.ts";
import {
  buildHostedChildToolContext,
  getDiscoveredHostTools,
  resolveHostedChildAgentExecutionConfig,
  resolveHostedChildToolNames,
  resolveHostedDelegationBinding,
  resolveMcpServers,
} from "./cloud-agent-child-tools.ts";
import {
  createControlPlaneRegistrationLifecycle,
  createNodeVeryfrontCloudAgentServiceRuntimeOptions,
  type NodeVeryfrontCloudAgentServicePreparedExecution,
} from "./cloud-agent-chat-execution.ts";

const DEFAULT_HARD_SHUTDOWN_TIMEOUT_MS = 20_000;

/** Public API contract for node Veryfront Cloud agent service process target. */
export type NodeVeryfrontCloudAgentServiceProcessTarget =
  & NonNullable<RunAgentServiceMainOptions["processTarget"]>
  & NonNullable<CreateNodeAgentServiceRuntimeInfrastructureOptions["processTarget"]>
  & {
    env?: Record<string, string | undefined>;
    exit?: (code: number) => never | void;
  };

export type NodeVeryfrontCloudAgentServiceAgentSource = ProjectAgentRuntimeAgentSource;

/** Public API contract for node Veryfront Cloud agent service MCP server. */
export type NodeVeryfrontCloudAgentServiceMcpServer = AgentServiceMcpServerConfig;

/** Veryfront API MCP server helper. */
export function veryfrontApiMcpServer():
  & AgentServiceMcpServerConfig
  & AgentVeryfrontMcpServerConfig {
  return { kind: "veryfront-api" };
}

/** Veryfront Studio MCP server helper. */
export function veryfrontStudioMcpServer():
  & AgentServiceMcpServerConfig
  & AgentVeryfrontMcpServerConfig {
  return { kind: "veryfront-studio" };
}

/** Options accepted by node Veryfront Cloud agent service. */
export type NodeVeryfrontCloudAgentServiceOptions = {
  /**
   * Stable service identity used by the control plane and service runtime.
   * Defaults to VERYFRONT_AGENT_SERVICE_NAME, then the nearest project
   * package.json or deno.json name, then "veryfront-agent-service".
   */
  serviceName?: string;
  /**
   * Default agent served by requests that do not provide an agent id. When
   * omitted, the service selects the only discovered code or markdown agent.
   */
  agentId?: string;
  /**
   * Project/discovery root. Defaults to the process cwd when neither baseDir
   * nor an entrypoint URL is provided.
   */
  baseDir?: string | URL;
  projectDir?: string;
  /**
   * Convenience URL for deriving baseDir from the entry module location.
   */
  entrypointUrl?: string | URL;
  /**
   * Exact immutable source snapshot contained in this service deployment.
   * Control-plane invocations are rejected when this is omitted or mismatched.
   * Mutable branch sources are not supported by standalone agent services.
   */
  runtimeSource?: HostedRuntimeSourceIdentity;
  agentSource?: NodeVeryfrontCloudAgentServiceAgentSource;
  /**
   * Remote MCP servers available to the runtime. Defaults to the Veryfront API
   * MCP server. Pass [] to run without remote MCP tools.
   */
  mcpServers?: readonly NodeVeryfrontCloudAgentServiceMcpServer[];
  forwardedConfigNamespace?: string;
  createBashTool?: AgentServiceSandboxToolsOptions["createBashTool"];
  env?: CreateNodeAgentServiceRuntimeInfrastructureOptions["env"];
  processTarget?: NodeVeryfrontCloudAgentServiceProcessTarget;
  drainTimeoutMs?: number;
  hardShutdownTimeoutMs?: number;
  signals?: readonly NodeJS.Signals[];
};

/** Options accepted by Veryfront Cloud agent service. */
export type VeryfrontCloudAgentServiceOptions = NodeVeryfrontCloudAgentServiceOptions;
/** Options accepted by agent service. */
export type AgentServiceOptions = NodeVeryfrontCloudAgentServiceOptions;

/** Public API contract for node Veryfront Cloud agent service prepared execution. */
export type { NodeVeryfrontCloudAgentServicePreparedExecution };
/** Public API contract for agent service prepared execution. */
export type AgentServicePreparedExecution = NodeVeryfrontCloudAgentServicePreparedExecution;
/** Public API contract for agent service process target. */
export type AgentServiceProcessTarget = NodeVeryfrontCloudAgentServiceProcessTarget;

export { getDiscoveredHostTools };

/** Internal test seams for hosted project-agent materialization. */
export const veryfrontCloudAgentServiceInternals = {
  buildHostedChildToolContext,
  resolveHostedDelegationBinding,
  resolveHostedChildAgentExecutionConfig,
  resolveHostedChildToolNames,
  resolveMcpServers,
};

/** Create node Veryfront Cloud agent service runtime. */
export async function createNodeVeryfrontCloudAgentServiceRuntime(
  options: NodeVeryfrontCloudAgentServiceOptions = {},
): Promise<AgentServiceRuntimeBundle<NodeVeryfrontCloudAgentServicePreparedExecution>> {
  const resolvedOptions = await resolveNodeVeryfrontCloudAgentServiceOptions(options);
  const context = createNodeVeryfrontCloudAgentServiceContext(resolvedOptions);
  await initializeNodeVeryfrontCloudAgentServiceContext(context);
  return createAgentServiceRuntime(createNodeVeryfrontCloudAgentServiceRuntimeOptions(context));
}

/** Starts node Veryfront Cloud agent service. */
export async function startNodeVeryfrontCloudAgentService(
  options: NodeVeryfrontCloudAgentServiceOptions = {},
): Promise<StartNodeAgentServiceResult<NodeVeryfrontCloudAgentServicePreparedExecution>> {
  const resolvedOptions = await resolveNodeVeryfrontCloudAgentServiceOptions(options);
  const context = createNodeVeryfrontCloudAgentServiceContext(resolvedOptions);
  await initializeNodeVeryfrontCloudAgentServiceContext(context);
  const registrationLifecycle = await createControlPlaneRegistrationLifecycle(context);
  try {
    return await startNodeAgentService({
      ...createNodeVeryfrontCloudAgentServiceRuntimeOptions(context),
      lifecycle: registrationLifecycle,
      signals: options.signals,
      hardShutdownTimeoutMs: options.hardShutdownTimeoutMs ?? DEFAULT_HARD_SHUTDOWN_TIMEOUT_MS,
    });
  } catch (error) {
    await registrationLifecycle?.stop?.();
    throw error;
  }
}

/** Starts agent service. */
export async function startAgentService(
  options: NodeVeryfrontCloudAgentServiceOptions = {},
): Promise<void> {
  const processTarget = options.processTarget ?? resolveDefaultProcessTarget();
  let getRuntimeTraceContext: NonNullable<BootstrapAgentServiceOptions["getTraceContext"]> =
    () => ({});

  await loadAgentServiceEnvFiles();
  const resolvedOptions = await resolveNodeVeryfrontCloudAgentServiceOptions(options);
  const context = createNodeVeryfrontCloudAgentServiceContext({
    ...resolvedOptions,
    processTarget,
  });
  getRuntimeTraceContext = context.infrastructure.getTraceContext;
  await initializeNodeVeryfrontCloudAgentServiceContext(context);

  await runAgentServiceMain({
    loadLogger: () => context.infrastructure.logger,
    initializeTelemetry: async () => {
      return await context.infrastructure.initializeOpenTelemetry().catch((error) => {
        agentLogger.error("Failed to initialize OpenTelemetry:", { error });
        return false;
      });
    },
    onTelemetryInitialized: () => {
      agentLogger.info("OpenTelemetry initialized successfully");
    },
    getTraceContext: () => getRuntimeTraceContext(),
    registerTraceContextGetter: (getter) => {
      __registerTraceContextGetter(getter);
    },
    start: async () => {
      const registrationLifecycle = await createControlPlaneRegistrationLifecycle(context);
      try {
        await startAgentServiceRuntime({
          ...createNodeVeryfrontCloudAgentServiceRuntimeOptions(context),
          lifecycle: registrationLifecycle,
          signals: options.signals,
          hardShutdownTimeoutMs: options.hardShutdownTimeoutMs ?? DEFAULT_HARD_SHUTDOWN_TIMEOUT_MS,
        });
      } catch (error) {
        await registrationLifecycle?.stop?.();
        throw error;
      }
    },
    onStartupError: (error) => {
      agentLogger.error("Error in server startup:", { error });
    },
    exit: processTarget?.exit,
    processTarget,
  });
}
