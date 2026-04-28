import type { Agent } from "./types.ts";

/**
 * Transport-neutral durable run lifecycle sink reserved for hosted agent-service
 * adoption work.
 */
export interface DurableRunSink<
  TStartInput = void,
  TRun = unknown,
  TEvent = unknown,
  TTerminalState = unknown,
> {
  startRun(input: TStartInput): Promise<TRun> | TRun;
  appendEvents(run: TRun, events: TEvent[]): Promise<void> | void;
  finalizeRun(run: TRun, terminalState: TTerminalState): Promise<void> | void;
  cancelRun(run: TRun, terminalState: TTerminalState): Promise<void> | void;
}

/**
 * Placeholder host-facing server config reserved for the future hosted service
 * implementation.
 */
export interface AgentServiceServerConfig {
  port?: number;
  basePath?: string;
  cors?: boolean;
}

export interface AgentServiceRoute {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";
  path: string;
  handler: (request: Request, params: Record<string, string>) => Promise<Response> | Response;
}

export interface AgentServiceRuntime<
  TStartInput = void,
  TRun = unknown,
  TEvent = unknown,
  TTerminalState = unknown,
> {
  readonly contract: NormalizedAgentServiceContract<TStartInput, TRun, TEvent, TTerminalState>;
  fetch(request: Request): Promise<Response>;
  setShuttingDown(shuttingDown?: boolean): void;
}

export type AgentRegistry = Record<string, Agent>;

export interface AgentServiceContractBase<
  TStartInput = void,
  TRun = unknown,
  TEvent = unknown,
  TTerminalState = unknown,
> {
  serviceName: string;
  server?: AgentServiceServerConfig;
  durableRunSink?: DurableRunSink<TStartInput, TRun, TEvent, TTerminalState>;
}

/**
 * Multi-agent hosted-service contract. Framework services route to
 * `defaultAgentId` unless the host chooses another registered agent.
 */
export interface AgentServiceRegistryContract<
  TStartInput = void,
  TRun = unknown,
  TEvent = unknown,
  TTerminalState = unknown,
> extends AgentServiceContractBase<TStartInput, TRun, TEvent, TTerminalState> {
  agents: AgentRegistry;
  defaultAgentId: string;
}

/**
 * Single-agent convenience accepted by `defineAgentService()`. Implementations
 * must normalize this shape into the same registry path used by multi-agent
 * services so framework users are not boxed into one-agent-per-process.
 */
export interface AgentServiceSingleAgentContract<
  TStartInput = void,
  TRun = unknown,
  TEvent = unknown,
  TTerminalState = unknown,
> extends AgentServiceContractBase<TStartInput, TRun, TEvent, TTerminalState> {
  agent: Agent;
  defaultAgentId?: string;
}

/**
 * Phase-0 contract draft for the future framework-owned hosted agent service.
 */
export type AgentContract<
  TStartInput = void,
  TRun = unknown,
  TEvent = unknown,
  TTerminalState = unknown,
> =
  | AgentServiceRegistryContract<TStartInput, TRun, TEvent, TTerminalState>
  | AgentServiceSingleAgentContract<TStartInput, TRun, TEvent, TTerminalState>;

export interface NormalizedAgentServiceContract<
  TStartInput = void,
  TRun = unknown,
  TEvent = unknown,
  TTerminalState = unknown,
> extends AgentServiceContractBase<TStartInput, TRun, TEvent, TTerminalState> {
  agents: AgentRegistry;
  defaultAgentId: string;
}

/**
 * Type-preserving service definition reserved ahead of the runtime
 * implementation landing in a later migration phase.
 */
export interface AgentServiceDefinition<
  TStartInput = void,
  TRun = unknown,
  TEvent = unknown,
  TTerminalState = unknown,
> {
  contract: NormalizedAgentServiceContract<TStartInput, TRun, TEvent, TTerminalState>;
  createRuntime(options?: { routes?: AgentServiceRoute[] }): AgentServiceRuntime<
    TStartInput,
    TRun,
    TEvent,
    TTerminalState
  >;
}

function getSingleAgentDefaultId(contract: {
  agent: Agent;
  defaultAgentId?: string;
}): string {
  return contract.defaultAgentId ?? contract.agent.id ?? "default";
}

function normalizeAgentServiceContract<
  TStartInput = void,
  TRun = unknown,
  TEvent = unknown,
  TTerminalState = unknown,
>(
  contract: AgentContract<TStartInput, TRun, TEvent, TTerminalState>,
): NormalizedAgentServiceContract<TStartInput, TRun, TEvent, TTerminalState> {
  if ("agents" in contract) {
    return {
      serviceName: contract.serviceName,
      agents: contract.agents,
      defaultAgentId: contract.defaultAgentId,
      server: contract.server,
      durableRunSink: contract.durableRunSink,
    };
  }

  const defaultAgentId = getSingleAgentDefaultId(contract);
  return {
    serviceName: contract.serviceName,
    agents: { [defaultAgentId]: contract.agent },
    defaultAgentId,
    server: contract.server,
    durableRunSink: contract.durableRunSink,
  };
}

function normalizePath(path: string): string {
  if (path === "") return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function splitPath(path: string): string[] {
  const normalized = normalizePath(path);
  if (normalized === "/") return [];
  return normalized.split("/").filter(Boolean);
}

function matchRoute(
  route: AgentServiceRoute,
  request: Request,
): Record<string, string> | undefined {
  if (request.method.toUpperCase() !== route.method) {
    return undefined;
  }

  const routeParts = splitPath(route.path);
  const requestParts = splitPath(new URL(request.url).pathname);
  if (routeParts.length !== requestParts.length) {
    return undefined;
  }

  const params: Record<string, string> = {};
  for (const [index, routePart] of routeParts.entries()) {
    const requestPart = requestParts[index];
    if (requestPart === undefined) {
      return undefined;
    }

    if (routePart.startsWith(":")) {
      params[routePart.slice(1)] = decodeURIComponent(requestPart);
      continue;
    }

    if (routePart !== requestPart) {
      return undefined;
    }
  }

  return params;
}

function createAgentServiceRuntime<
  TStartInput = void,
  TRun = unknown,
  TEvent = unknown,
  TTerminalState = unknown,
>(
  contract: NormalizedAgentServiceContract<TStartInput, TRun, TEvent, TTerminalState>,
  options: { routes?: AgentServiceRoute[] } = {},
): AgentServiceRuntime<TStartInput, TRun, TEvent, TTerminalState> {
  let shuttingDown = false;
  const routes = options.routes ?? [];

  return {
    contract,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (request.method === "GET" && path === "/readiness") {
        return shuttingDown ? new Response("Shutting down", { status: 503 }) : new Response("OK");
      }
      if (request.method === "GET" && path === "/liveness") {
        return new Response("OK");
      }

      for (const route of routes) {
        const params = matchRoute(route, request);
        if (params) {
          return await route.handler(request, params);
        }
      }

      return new Response("Not Found", { status: 404 });
    },
    setShuttingDown(next = true) {
      shuttingDown = next;
    },
  };
}

/**
 * Define a hosted agent service and expose a policy-neutral runtime shell.
 *
 * The first implementation slice owns contract normalization plus standard
 * health/readiness behavior. Hosts pass product-specific routes explicitly so
 * auth, observability, durable sinks, and AG-UI execution policy can keep
 * migrating in smaller additive seams.
 */
export function defineAgentService<
  TStartInput = void,
  TRun = unknown,
  TEvent = unknown,
  TTerminalState = unknown,
>(
  contract: AgentContract<TStartInput, TRun, TEvent, TTerminalState>,
): AgentServiceDefinition<TStartInput, TRun, TEvent, TTerminalState> {
  const normalized = normalizeAgentServiceContract(contract);
  return {
    contract: normalized,
    createRuntime(options) {
      return createAgentServiceRuntime(normalized, options);
    },
  };
}
