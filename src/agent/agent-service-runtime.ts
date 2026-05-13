import { agent } from "./factory.ts";
import {
  type AgentServiceRoute,
  type AgentServiceRuntime,
  defineAgentService,
} from "./agent-service.ts";
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
} from "./agent-service-routes.ts";
import {
  type AgentServiceAuth,
  type AgentServiceAuthConfig,
  createAgentServiceAuth,
} from "./agent-service-auth.ts";
import type { ParsedHostedChatRequest } from "./hosted-chat-request-parser.ts";
import type { AgUiResumeValue } from "./ag-ui-tool-shared.ts";
import type { RuntimeAgentMarkdownDefinition } from "./runtime-agent-definition.ts";
import {
  type AgentServiceServer,
  type NodeAgentServiceServer,
  startAgentServiceServer,
  startNodeAgentServiceServer,
} from "./agent-service-server.ts";
import type { VeryfrontServiceServerLogger } from "../server/service-server.ts";

export type HostedAgentServiceRuntimeConfig = AgentServiceAuthConfig & {
  PORT: number;
  ALLOWED_ORIGINS: string[];
};

export type AgentServiceRuntimeConfig = HostedAgentServiceRuntimeConfig;

export type HostedAgentServiceRuntimeLogger = VeryfrontServiceServerLogger & {
  info(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
};

export type AgentServiceRuntimeLogger = HostedAgentServiceRuntimeLogger;

export type HostedAgentServiceRuntimeTrace = <TResult>(
  operationName: string,
  operation: () => Promise<TResult>,
) => Promise<TResult>;

export type AgentServiceRuntimeTrace = HostedAgentServiceRuntimeTrace;

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

export type CreateAgentServiceRuntimeOptions<
  TExecution extends object,
  TConfig extends AgentServiceRuntimeConfig = AgentServiceRuntimeConfig,
> = CreateHostedAgentServiceRuntimeOptions<TExecution, TConfig>;

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

export type AgentServiceRuntimeBundle<
  TExecution extends object,
  TConfig extends AgentServiceRuntimeConfig = AgentServiceRuntimeConfig,
> = HostedAgentServiceRuntimeBundle<TExecution, TConfig>;

export type StartNodeHostedAgentServiceOptions<
  TExecution extends object,
  TConfig extends HostedAgentServiceRuntimeConfig = HostedAgentServiceRuntimeConfig,
> = CreateHostedAgentServiceRuntimeOptions<TExecution, TConfig> & {
  bindAddress?: string;
  hardShutdownTimeoutMs?: number;
  signals?: readonly NodeJS.Signals[];
};

export type StartNodeAgentServiceOptions<
  TExecution extends object,
  TConfig extends AgentServiceRuntimeConfig = AgentServiceRuntimeConfig,
> = StartNodeHostedAgentServiceOptions<TExecution, TConfig>;

export type StartAgentServiceRuntimeOptions<
  TExecution extends object,
  TConfig extends AgentServiceRuntimeConfig = AgentServiceRuntimeConfig,
> = CreateAgentServiceRuntimeOptions<TExecution, TConfig> & {
  bindAddress?: string;
  hardShutdownTimeoutMs?: number;
  signals?: readonly NodeJS.Signals[];
};

export type StartNodeHostedAgentServiceResult<
  TExecution extends object,
  TConfig extends HostedAgentServiceRuntimeConfig = HostedAgentServiceRuntimeConfig,
> = HostedAgentServiceRuntimeBundle<TExecution, TConfig> & {
  nodeServer: NodeAgentServiceServer;
};

export type StartNodeAgentServiceResult<
  TExecution extends object,
  TConfig extends AgentServiceRuntimeConfig = AgentServiceRuntimeConfig,
> = StartNodeHostedAgentServiceResult<TExecution, TConfig>;

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
      maxSteps: agentConfig.maxSteps,
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

export function createHostedAgentServiceRuntime<
  TExecution extends object,
  TConfig extends HostedAgentServiceRuntimeConfig = HostedAgentServiceRuntimeConfig,
>(
  options: CreateHostedAgentServiceRuntimeOptions<TExecution, TConfig>,
): HostedAgentServiceRuntimeBundle<TExecution, TConfig> {
  return createAgentServiceRuntime(options);
}

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
    lifecycle: bundle.lifecycle,
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

export async function startNodeHostedAgentService<
  TExecution extends object,
  TConfig extends HostedAgentServiceRuntimeConfig = HostedAgentServiceRuntimeConfig,
>(
  options: StartNodeHostedAgentServiceOptions<TExecution, TConfig>,
): Promise<StartNodeHostedAgentServiceResult<TExecution, TConfig>> {
  return startNodeAgentService(options);
}

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
    lifecycle: bundle.lifecycle,
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
