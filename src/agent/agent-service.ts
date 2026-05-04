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
export type AgentServiceRouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

export interface AgentServiceCorsConfig {
  origins?: string[];
  credentials?: boolean;
  allowMethods?: AgentServiceRouteMethod[];
  allowHeaders?: string[];
  maxAgeSeconds?: number;
}

export interface AgentServiceServerConfig {
  port?: number;
  basePath?: string;
  cors?: boolean | AgentServiceCorsConfig;
}

export interface AgentServiceRoute {
  method: AgentServiceRouteMethod;
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
  request(input: string | URL | Request, init?: RequestInit): Promise<Response>;
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

function normalizeCorsConfig(
  server: AgentServiceServerConfig | undefined,
): AgentServiceCorsConfig | undefined {
  const cors = server?.cors;
  if (!cors) return undefined;
  if (cors === true) return { origins: ["*"] };
  return cors;
}

function getAllowedCorsOrigin(
  config: AgentServiceCorsConfig,
  request: Request,
): string | undefined {
  const origin = request.headers.get("Origin");
  if (!origin) return undefined;

  const origins = config.origins ?? ["*"];
  if (origins.includes("*")) {
    return config.credentials ? origin : "*";
  }

  return origins.includes(origin) ? origin : undefined;
}

function appendCorsHeaders(
  headers: Headers,
  config: AgentServiceCorsConfig,
  request: Request,
): void {
  const allowedOrigin = getAllowedCorsOrigin(config, request);
  if (!allowedOrigin) return;

  headers.set("Access-Control-Allow-Origin", allowedOrigin);
  headers.append("Vary", "Origin");

  if (config.credentials) {
    headers.set("Access-Control-Allow-Credentials", "true");
  }
}

function createCorsPreflightResponse(
  request: Request,
  config: AgentServiceCorsConfig,
): Response {
  const headers = new Headers();
  appendCorsHeaders(headers, config, request);

  const allowMethods = config.allowMethods ?? ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
  headers.set("Access-Control-Allow-Methods", allowMethods.join(", "));

  const requestedHeaders = request.headers.get("Access-Control-Request-Headers");
  const allowHeaders = config.allowHeaders?.join(", ") ?? requestedHeaders;
  if (allowHeaders) {
    headers.set("Access-Control-Allow-Headers", allowHeaders);
  }

  if (config.maxAgeSeconds !== undefined) {
    headers.set("Access-Control-Max-Age", String(config.maxAgeSeconds));
  }

  return new Response(null, { status: 204, headers });
}

function withCorsHeaders(
  response: Response,
  config: AgentServiceCorsConfig | undefined,
  request: Request,
): Response {
  if (!config) return response;

  const headers = new Headers(response.headers);
  appendCorsHeaders(headers, config, request);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function toRuntimeRequest(input: string | URL | Request, init?: RequestInit): Request {
  if (input instanceof Request) {
    return init === undefined ? input : new Request(input, init);
  }

  const requestUrl = typeof input === "string" ? new URL(input, "http://localhost") : input;
  return new Request(requestUrl, init);
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
  const corsConfig = normalizeCorsConfig(contract.server);

  const runtime: AgentServiceRuntime<TStartInput, TRun, TEvent, TTerminalState> = {
    contract,
    async fetch(request) {
      if (
        corsConfig && request.method === "OPTIONS" &&
        request.headers.has("Access-Control-Request-Method")
      ) {
        return createCorsPreflightResponse(request, corsConfig);
      }

      const path = new URL(request.url).pathname;
      let response: Response;
      if (request.method === "GET" && path === "/readiness") {
        response = shuttingDown
          ? new Response("Shutting down", { status: 503 })
          : new Response("OK");
        return withCorsHeaders(response, corsConfig, request);
      }
      if (request.method === "GET" && path === "/liveness") {
        response = new Response("OK");
        return withCorsHeaders(response, corsConfig, request);
      }

      for (const route of routes) {
        const params = matchRoute(route, request);
        if (params) {
          response = await route.handler(request, params);
          return withCorsHeaders(response, corsConfig, request);
        }
      }

      response = new Response("Not Found", { status: 404 });
      return withCorsHeaders(response, corsConfig, request);
    },
    request(input, init) {
      return runtime.fetch(toRuntimeRequest(input, init));
    },
    setShuttingDown(next = true) {
      shuttingDown = next;
    },
  };

  return runtime;
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
