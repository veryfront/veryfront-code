import {
  createVeryfrontServer,
  type NodeVeryfrontServiceServer,
  startNodeVeryfrontServer,
  startVeryfrontServer,
  type VeryfrontServiceServer,
  type VeryfrontServiceServerLogger,
  type VeryfrontServiceServerRuntime,
} from "../../server/service-server.ts";
import type { AgentServiceRuntime } from "./definition.ts";

/** Public API contract for agent service server lifecycle. */
export type AgentServiceServerLifecycle = {
  setShuttingDown?: () => void;
  stop?: () => void | Promise<void>;
};

/** Options accepted by create agent service server runtime. */
export type CreateAgentServiceServerRuntimeOptions = {
  runtime: AgentServiceRuntime;
  serviceName?: string;
  lifecycle?: AgentServiceServerLifecycle;
  logger?: VeryfrontServiceServerLogger;
};

/** Options accepted by start node agent service server. */
export type StartNodeAgentServiceServerOptions = CreateAgentServiceServerRuntimeOptions & {
  port: number;
  bindAddress?: string;
  signals?: readonly NodeJS.Signals[];
  hardShutdownTimeoutMs?: number;
};

/** Options accepted by start agent service server. */
export type StartAgentServiceServerOptions = CreateAgentServiceServerRuntimeOptions & {
  port: number;
  bindAddress?: string;
  signals?: readonly NodeJS.Signals[];
  hardShutdownTimeoutMs?: number;
};

/** Public API contract for node agent service server. */
export type NodeAgentServiceServer = NodeVeryfrontServiceServer;
/** Public API contract for agent service server. */
export type AgentServiceServer = VeryfrontServiceServer | NodeVeryfrontServiceServer;

function getAgentServiceServerName(
  options: CreateAgentServiceServerRuntimeOptions,
): string {
  return options.serviceName ?? options.runtime.contract.serviceName;
}

/** Create agent service server runtime. */
export function createAgentServiceServerRuntime(
  options: CreateAgentServiceServerRuntimeOptions,
): VeryfrontServiceServerRuntime {
  const serviceName = getAgentServiceServerName(options);

  return createVeryfrontServer({
    modules: [
      {
        name: serviceName,
        handle: (request) => options.runtime.fetch(request),
        setShuttingDown: () => {
          options.runtime.setShuttingDown();
          options.lifecycle?.setShuttingDown?.();
        },
        stop: () => options.lifecycle?.stop?.(),
      },
    ],
    logger: options.logger,
  });
}

/** Starts node agent service server. */
export async function startNodeAgentServiceServer(
  options: StartNodeAgentServiceServerOptions,
): Promise<NodeAgentServiceServer> {
  const runtime = createAgentServiceServerRuntime(options);
  const server = await startNodeVeryfrontServer({
    runtime,
    port: options.port,
    bindAddress: options.bindAddress,
    logger: options.logger,
    signals: options.signals,
    hardShutdownTimeoutMs: options.hardShutdownTimeoutMs,
  });
  await server.ready;
  return server;
}

/** Starts agent service server. */
export async function startAgentServiceServer(
  options: StartAgentServiceServerOptions,
): Promise<AgentServiceServer> {
  const runtime = createAgentServiceServerRuntime(options);
  const server = await startVeryfrontServer({
    runtime,
    port: options.port,
    bindAddress: options.bindAddress,
    logger: options.logger,
    signals: options.signals,
    hardShutdownTimeoutMs: options.hardShutdownTimeoutMs,
  });
  await server.ready;
  return server;
}
