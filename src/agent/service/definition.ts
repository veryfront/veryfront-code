import type { Agent } from "../types.ts";

// Capture before project modules load: ingress requests still carry host
// credentials while the service selects a route and applies CORS policy.
const IntrinsicReflectApply = Reflect.apply;
const NativeRequest = Request;
const NativeURL = URL;
const NativeHasInstance = Function.prototype[Symbol.hasInstance];
const RequestMethodGet = Object.getOwnPropertyDescriptor(NativeRequest.prototype, "method")?.get;
const RequestUrlGet = Object.getOwnPropertyDescriptor(NativeRequest.prototype, "url")?.get;
const RequestHeadersGet = Object.getOwnPropertyDescriptor(NativeRequest.prototype, "headers")?.get;
const URLPathnameGet = Object.getOwnPropertyDescriptor(NativeURL.prototype, "pathname")?.get;
const URLHrefGet = Object.getOwnPropertyDescriptor(NativeURL.prototype, "href")?.get;
const HeadersGet = Headers.prototype.get;
const StringToUpperCase = String.prototype.toUpperCase;

function readNativeValue<T>(target: Request | URL, getter: (() => T) | undefined): T {
  if (!getter) throw new TypeError("Request routing accessor is unavailable");
  return IntrinsicReflectApply(getter, target, []) as T;
}

function readRequestHeader(request: Request, name: string): string | null {
  const headers = readNativeValue<Headers>(request, RequestHeadersGet);
  return IntrinsicReflectApply(HeadersGet, headers, [name]) as string | null;
}

/**
 * Transport-neutral durable run lifecycle sink for agent-service adoption work.
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
 * Host-facing server config for the agent service runtime shell.
 */
export type AgentServiceRouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

/** Configuration used by agent service cors. */
export interface AgentServiceCorsConfig {
  origins?: string[];
  credentials?: boolean;
  allowMethods?: AgentServiceRouteMethod[];
  allowHeaders?: string[];
  maxAgeSeconds?: number;
}

/** Configuration used by agent service server. */
export interface AgentServiceServerConfig {
  port?: number;
  basePath?: string;
  cors?: boolean | AgentServiceCorsConfig;
}

/** Public API contract for agent service route. */
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

/** Public API contract for agent registry. */
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
 * Multi-agent service contract. Framework services route to
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
 * Framework-owned agent service contract.
 */
export type AgentContract<
  TStartInput = void,
  TRun = unknown,
  TEvent = unknown,
  TTerminalState = unknown,
> =
  | AgentServiceRegistryContract<TStartInput, TRun, TEvent, TTerminalState>
  | AgentServiceSingleAgentContract<TStartInput, TRun, TEvent, TTerminalState>;

/** Public API contract for normalized agent service contract. */
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
 * Type-preserving service definition for request-native agent service runtimes.
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
  method: string,
  path: string,
): Record<string, string> | undefined {
  if (IntrinsicReflectApply(StringToUpperCase, method, []) !== route.method) {
    return undefined;
  }

  const routeParts = splitPath(route.path);
  const requestParts = splitPath(path);
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
  const origin = readRequestHeader(request, "Origin");
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

  const requestedHeaders = readRequestHeader(request, "Access-Control-Request-Headers");
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
  if (IntrinsicReflectApply(NativeHasInstance, NativeRequest, [input])) {
    return init === undefined ? input as Request : new NativeRequest(input, init);
  }

  const requestUrl = typeof input === "string" ? new NativeURL(input, "http://localhost") : input;
  return new NativeRequest(readNativeValue<string>(requestUrl, URLHrefGet), init);
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
      const method = readNativeValue<string>(request, RequestMethodGet);
      if (
        corsConfig && method === "OPTIONS" &&
        readRequestHeader(request, "Access-Control-Request-Method") !== null
      ) {
        return createCorsPreflightResponse(request, corsConfig);
      }

      const url = new NativeURL(readNativeValue<string>(request, RequestUrlGet));
      const path = readNativeValue<string>(url, URLPathnameGet);
      let response: Response;
      if (method === "GET" && path === "/readiness") {
        response = shuttingDown
          ? new Response("Shutting down", { status: 503 })
          : new Response("OK");
        return withCorsHeaders(response, corsConfig, request);
      }
      if (method === "GET" && path === "/liveness") {
        response = new Response("OK");
        return withCorsHeaders(response, corsConfig, request);
      }

      for (const route of routes) {
        const params = matchRoute(route, method, path);
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
 * Define an agent service and expose a policy-neutral runtime shell.
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
