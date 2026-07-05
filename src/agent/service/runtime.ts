import { agent } from "../factory.ts";
import type { AgentConfig } from "../types.ts";
import {
  type AgentServiceRoute,
  type AgentServiceRuntime,
  defineAgentService,
} from "./definition.ts";
import {
  createDetachedRunShutdownLifecycle,
  createDetachedRunTracker,
  type DetachedRunShutdownLifecycle,
  type DetachedRunTracker,
} from "./detached-run-tracker.ts";
import {
  type AgentServiceActiveSpanAttributes,
  type AgentServiceDetachedCleanupInput,
  type AgentServiceDetachedExecutionInput,
  type AgentServiceRouteSet,
  type AgentServiceStreamExecutionInput,
  createAgentServiceRouteSet,
} from "./routes.ts";
import {
  type AgentServiceAuth,
  type AgentServiceAuthConfig,
  createAgentServiceAuth,
} from "./auth.ts";
import type { ParsedHostedChatRequest } from "../hosted/chat-request-parser.ts";
import type { AgUiResumeValue } from "../ag-ui/tool-shared.ts";
import type { RuntimeAgentMarkdownDefinition } from "../runtime/agent-definition.ts";
import {
  type AgentServiceServer,
  type AgentServiceServerLifecycle,
  type NodeAgentServiceServer,
  startAgentServiceServer,
  startNodeAgentServiceServer,
} from "./server.ts";
import type { VeryfrontServiceServerLogger } from "../../server/service-server.ts";

/** Configuration used by hosted agent service runtime. */
export type HostedAgentServiceRuntimeConfig = AgentServiceAuthConfig & {
  PORT: number;
  ALLOWED_ORIGINS: string[];
};

/** Configuration used by agent service runtime. */
export type AgentServiceRuntimeConfig = HostedAgentServiceRuntimeConfig;

/** Public API contract for hosted agent service runtime logger. */
export type HostedAgentServiceRuntimeLogger = VeryfrontServiceServerLogger & {
  info(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
};

/** Public API contract for agent service runtime logger. */
export type AgentServiceRuntimeLogger = HostedAgentServiceRuntimeLogger;

/** Public API contract for hosted agent service runtime trace. */
export type HostedAgentServiceRuntimeTrace = <TResult>(
  operationName: string,
  operation: () => Promise<TResult>,
) => Promise<TResult>;

/** Public API contract for agent service runtime trace. */
export type AgentServiceRuntimeTrace = HostedAgentServiceRuntimeTrace;

/** Options accepted by create hosted agent service runtime. */
export type CreateHostedAgentServiceRuntimeOptions<
  TExecution extends object,
  TConfig extends HostedAgentServiceRuntimeConfig = HostedAgentServiceRuntimeConfig,
> = {
  serviceName: string;
  getConfig: () => TConfig;
  getAgentConfig: () => RuntimeAgentMarkdownDefinition;
  forwardedConfigNamespace?: string;
  logger: HostedAgentServiceRuntimeLogger;
  trace?: HostedAgentServiceRuntimeTrace;
  setActiveSpanAttributes?: (attributes: AgentServiceActiveSpanAttributes) => void;
  prepareExecution: (req: ParsedHostedChatRequest) => Promise<TExecution>;
  streamExecutionToAgUiResponse: (
    input: AgentServiceStreamExecutionInput<TExecution>,
  ) => Promise<Response> | Response;
  startDetachedExecution: (
    input: AgentServiceDetachedExecutionInput<TExecution>,
  ) => Promise<void>;
  cleanupExecution?: (
    input: AgentServiceDetachedCleanupInput<TExecution>,
  ) => Promise<void>;
  tracker?: DetachedRunTracker<AgUiResumeValue>;
  drainTimeoutMs?: number;
};

/** Options accepted by create agent service runtime. */
export type CreateAgentServiceRuntimeOptions<
  TExecution extends object,
  TConfig extends AgentServiceRuntimeConfig = AgentServiceRuntimeConfig,
> = CreateHostedAgentServiceRuntimeOptions<TExecution, TConfig>;

/** Public API contract for hosted agent service runtime bundle. */
export type HostedAgentServiceRuntimeBundle<
  TExecution extends object,
  TConfig extends HostedAgentServiceRuntimeConfig = HostedAgentServiceRuntimeConfig,
> = {
  config: TConfig;
  tracker: DetachedRunTracker<AgUiResumeValue>;
  auth: AgentServiceAuth;
  routeSet: AgentServiceRouteSet<TExecution>;
  routes: AgentServiceRoute[];
  lifecycle: DetachedRunShutdownLifecycle;
  runtime: AgentServiceRuntime;
};

/** Public API contract for agent service runtime bundle. */
export type AgentServiceRuntimeBundle<
  TExecution extends object,
  TConfig extends AgentServiceRuntimeConfig = AgentServiceRuntimeConfig,
> = HostedAgentServiceRuntimeBundle<TExecution, TConfig>;

/** Options accepted by start node hosted agent service. */
export type StartNodeHostedAgentServiceOptions<
  TExecution extends object,
  TConfig extends HostedAgentServiceRuntimeConfig = HostedAgentServiceRuntimeConfig,
> = CreateHostedAgentServiceRuntimeOptions<TExecution, TConfig> & {
  bindAddress?: string;
  hardShutdownTimeoutMs?: number;
  signals?: readonly NodeJS.Signals[];
  lifecycle?: AgentServiceServerLifecycle;
};

/** Options accepted by start node agent service. */
export type StartNodeAgentServiceOptions<
  TExecution extends object,
  TConfig extends AgentServiceRuntimeConfig = AgentServiceRuntimeConfig,
> = StartNodeHostedAgentServiceOptions<TExecution, TConfig>;

/** Options accepted by start agent service runtime. */
export type StartAgentServiceRuntimeOptions<
  TExecution extends object,
  TConfig extends AgentServiceRuntimeConfig = AgentServiceRuntimeConfig,
> = CreateAgentServiceRuntimeOptions<TExecution, TConfig> & {
  bindAddress?: string;
  hardShutdownTimeoutMs?: number;
  signals?: readonly NodeJS.Signals[];
  lifecycle?: AgentServiceServerLifecycle;
};

/** Result returned from start node hosted agent service. */
export type StartNodeHostedAgentServiceResult<
  TExecution extends object,
  TConfig extends HostedAgentServiceRuntimeConfig = HostedAgentServiceRuntimeConfig,
> = HostedAgentServiceRuntimeBundle<TExecution, TConfig> & {
  nodeServer: NodeAgentServiceServer;
};

/** Result returned from start node agent service. */
export type StartNodeAgentServiceResult<
  TExecution extends object,
  TConfig extends AgentServiceRuntimeConfig = AgentServiceRuntimeConfig,
> = StartNodeHostedAgentServiceResult<TExecution, TConfig>;

/** Result returned from start agent service runtime. */
export type StartAgentServiceRuntimeResult<
  TExecution extends object,
  TConfig extends AgentServiceRuntimeConfig = AgentServiceRuntimeConfig,
> = AgentServiceRuntimeBundle<TExecution, TConfig> & {
  server: AgentServiceServer;
};

function defaultTrace<TResult>(
  _operationName: string,
  operation: () => Promise<TResult>,
): Promise<TResult> {
  return operation();
}

function normalizeAgentServiceTools(
  tools: RuntimeAgentMarkdownDefinition["tools"],
): AgentConfig["tools"] {
  if (tools === undefined || tools === true) {
    return tools;
  }

  return Object.fromEntries(tools.map((toolId) => [toolId, true]));
}

function combineAgentServiceLifecycle(
  primary: AgentServiceServerLifecycle,
  secondary: AgentServiceServerLifecycle | undefined,
): AgentServiceServerLifecycle {
  if (!secondary) {
    return primary;
  }

  return {
    setShuttingDown: () => {
      primary.setShuttingDown?.();
      secondary.setShuttingDown?.();
    },
    stop: async () => {
      await primary.stop?.();
      await secondary.stop?.();
    },
  };
}

/** Create agent service runtime. */
export function createAgentServiceRuntime<
  TExecution extends object,
  TConfig extends AgentServiceRuntimeConfig = AgentServiceRuntimeConfig,
>(
  options: CreateAgentServiceRuntimeOptions<TExecution, TConfig>,
): AgentServiceRuntimeBundle<TExecution, TConfig> {
  const config = options.getConfig();
  const tracker = options.tracker ?? createDetachedRunTracker<AgUiResumeValue>();
  const trace = options.trace ?? defaultTrace;
  const auth = createAgentServiceAuth({
    getConfig: options.getConfig,
    logger: options.logger,
    trace,
  });
  const routeSet = createAgentServiceRouteSet({
    forwardedConfigNamespace: options.forwardedConfigNamespace,
    authenticateRequest: auth.authenticateRequest,
    verifyProjectAccess: (projectId, authToken) => auth.verifyProjectAccess(projectId, authToken),
    tracker,
    prepareExecution: options.prepareExecution,
    streamExecutionToAgUiResponse: options.streamExecutionToAgUiResponse,
    startDetachedExecution: options.startDetachedExecution,
    cleanupExecution: options.cleanupExecution,
    setActiveSpanAttributes: options.setActiveSpanAttributes,
    trace,
    logger: options.logger,
  });
  const agentConfig = options.getAgentConfig();
  const service = defineAgentService({
    serviceName: options.serviceName,
    agent: agent({
      id: agentConfig.id,
      system: agentConfig.instructions,
      model: agentConfig.model,
      temperature: agentConfig.temperature,
      maxSteps: agentConfig.maxSteps,
      providerTools: agentConfig.providerTools,
      skills: agentConfig.skills,
      tools: normalizeAgentServiceTools(agentConfig.tools),
    }),
    server: {
      port: config.PORT,
      cors: {
        origins: config.ALLOWED_ORIGINS,
        credentials: true,
      },
    },
  });
  const routes = routeSet.routes;

  return {
    config,
    tracker,
    auth,
    routeSet,
    routes,
    lifecycle: createDetachedRunShutdownLifecycle({
      tracker,
      logger: options.logger,
      drainTimeoutMs: options.drainTimeoutMs,
    }),
    runtime: service.createRuntime({ routes }),
  };
}

/** Create hosted agent service runtime. */
export function createHostedAgentServiceRuntime<
  TExecution extends object,
  TConfig extends HostedAgentServiceRuntimeConfig = HostedAgentServiceRuntimeConfig,
>(
  options: CreateHostedAgentServiceRuntimeOptions<TExecution, TConfig>,
): HostedAgentServiceRuntimeBundle<TExecution, TConfig> {
  return createAgentServiceRuntime(options);
}

/** Starts node agent service. */
export async function startNodeAgentService<
  TExecution extends object,
  TConfig extends AgentServiceRuntimeConfig = AgentServiceRuntimeConfig,
>(
  options: StartNodeAgentServiceOptions<TExecution, TConfig>,
): Promise<StartNodeAgentServiceResult<TExecution, TConfig>> {
  const bundle = createAgentServiceRuntime(options);
  const nodeServer = await startNodeAgentServiceServer({
    runtime: bundle.runtime,
    serviceName: options.serviceName,
    lifecycle: combineAgentServiceLifecycle(bundle.lifecycle, options.lifecycle),
    port: bundle.config.PORT,
    bindAddress: options.bindAddress,
    signals: options.signals,
    logger: options.logger,
    hardShutdownTimeoutMs: options.hardShutdownTimeoutMs,
  });

  return {
    ...bundle,
    nodeServer,
  };
}

/** Starts node hosted agent service. */
export async function startNodeHostedAgentService<
  TExecution extends object,
  TConfig extends HostedAgentServiceRuntimeConfig = HostedAgentServiceRuntimeConfig,
>(
  options: StartNodeHostedAgentServiceOptions<TExecution, TConfig>,
): Promise<StartNodeHostedAgentServiceResult<TExecution, TConfig>> {
  return startNodeAgentService(options);
}

/** Starts agent service runtime. */
export async function startAgentServiceRuntime<
  TExecution extends object,
  TConfig extends AgentServiceRuntimeConfig = AgentServiceRuntimeConfig,
>(
  options: StartAgentServiceRuntimeOptions<TExecution, TConfig>,
): Promise<StartAgentServiceRuntimeResult<TExecution, TConfig>> {
  const bundle = createAgentServiceRuntime(options);
  const server = await startAgentServiceServer({
    runtime: bundle.runtime,
    serviceName: options.serviceName,
    lifecycle: combineAgentServiceLifecycle(bundle.lifecycle, options.lifecycle),
    port: bundle.config.PORT,
    bindAddress: options.bindAddress,
    signals: options.signals,
    logger: options.logger,
    hardShutdownTimeoutMs: options.hardShutdownTimeoutMs,
  });

  return {
    ...bundle,
    server,
  };
}
