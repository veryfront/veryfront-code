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

export type AgentServiceServerLifecycle = {
  setShuttingDown?: () => void;
  stop?: () => void | Promise<void>;
};

export type CreateAgentServiceServerRuntimeOptions = {
  runtime: AgentServiceRuntime;
  serviceName?: string;
  lifecycle?: AgentServiceServerLifecycle;
  logger?: VeryfrontServiceServerLogger;
};

export type StartNodeAgentServiceServerOptions = CreateAgentServiceServerRuntimeOptions & {
  port: number;
  bindAddress?: string;
  signals?: readonly NodeJS.Signals[];
  hardShutdownTimeoutMs?: number;
};

export type StartAgentServiceServerOptions = CreateAgentServiceServerRuntimeOptions & {
  port: number;
  bindAddress?: string;
  signals?: readonly NodeJS.Signals[];
  hardShutdownTimeoutMs?: number;
};

export type NodeAgentServiceServer = NodeVeryfrontServiceServer;
export type AgentServiceServer = VeryfrontServiceServer | NodeVeryfrontServiceServer;

function getAgentServiceServerName(
  options: CreateAgentServiceServerRuntimeOptions,
): string {
  return options.serviceName ?? options.runtime.contract.serviceName;
}

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
