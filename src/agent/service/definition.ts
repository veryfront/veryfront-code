import type { Agent } from "../types.ts";

// Capture before project modules load: ingress requests still carry host
// credentials while the service selects a route and applies CORS policy.
const IntrinsicReflectApply = Reflect.apply;
const IntrinsicReflectSet = Reflect.set;
const NativeMap = Map;
const NativeRequest = Request;
const NativeURL = URL;
const NativeHeaders = Headers;
const NativeResponse = Response;
const NativeSet = Set;
const NativeString = String;
const NativeURLSearchParams = URLSearchParams;
const NativeHasInstance = Function.prototype[Symbol.hasInstance];
const NativeArrayFrom = Array.from;
const NativeArrayIsArray = Array.isArray;
const ObjectCreate = Object.create;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectDefineProperty = Object.defineProperty;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectKeys = Object.keys;
const NativeObjectPrototype = Object.prototype;
const SymbolIterator = Symbol.iterator;
const RequestMethodGet = Object.getOwnPropertyDescriptor(NativeRequest.prototype, "method")?.get;
const RequestUrlGet = Object.getOwnPropertyDescriptor(NativeRequest.prototype, "url")?.get;
const RequestHeadersGet = Object.getOwnPropertyDescriptor(NativeRequest.prototype, "headers")?.get;
const ResponseBodyGet = Object.getOwnPropertyDescriptor(NativeResponse.prototype, "body")?.get;
const ResponseHeadersGet = Object.getOwnPropertyDescriptor(NativeResponse.prototype, "headers")
  ?.get;
const ResponseStatusGet = Object.getOwnPropertyDescriptor(NativeResponse.prototype, "status")?.get;
const ResponseStatusTextGet = Object.getOwnPropertyDescriptor(
  NativeResponse.prototype,
  "statusText",
)?.get;
const URLPathnameGet = Object.getOwnPropertyDescriptor(NativeURL.prototype, "pathname")?.get;
const URLHrefGet = Object.getOwnPropertyDescriptor(NativeURL.prototype, "href")?.get;
const HeadersGet = Headers.prototype.get;
const HeadersSet = Headers.prototype.set;
const HeadersAppend = Headers.prototype.append;
const HeadersDelete = Headers.prototype.delete;
const HeadersForEach = Headers.prototype.forEach;
const MapForEach = Map.prototype.forEach;
const SetForEach = Set.prototype.forEach;
const URLSearchParamsForEach = URLSearchParams.prototype.forEach;
const StringStartsWith = String.prototype.startsWith;
const StringIndexOf = String.prototype.indexOf;
const StringSlice = String.prototype.slice;
const NativeDecodeURIComponent = decodeURIComponent;
const StringToUpperCase = String.prototype.toUpperCase;
const ObjectHasOwn = Object.hasOwn;
const EmptyHeadersInit: Record<string, string> = ObjectCreate(null);
const RequestInitFields = [
  "body",
  "cache",
  "client",
  "credentials",
  "duplex",
  "headers",
  "integrity",
  "keepalive",
  "method",
  "mode",
  "priority",
  "redirect",
  "referrer",
  "referrerPolicy",
  "signal",
  "window",
] as const;
const RequestInitGetters: Record<string, (() => unknown) | undefined> = ObjectCreate(null);
for (let index = 0; index < RequestInitFields.length; index++) {
  const field = RequestInitFields[index]!;
  RequestInitGetters[field] = ObjectGetOwnPropertyDescriptor(NativeRequest.prototype, field)?.get;
}

interface ServerConfigCarrier {
  server?: AgentServiceServerConfig;
}

type PrototypeInspectable =
  | ServerConfigCarrier
  | AgentServiceCorsConfig
  | AgentServiceServerConfig
  | HeadersInit
  | RequestInit
  | { routes?: AgentServiceRoute[] };

function readNativeValue<T>(target: Request | Response | URL, getter: (() => T) | undefined): T {
  if (!getter) throw new TypeError("Request routing accessor is unavailable");
  return IntrinsicReflectApply(getter, target, []) as T;
}

function readRequestHeader(request: Request, name: string): string | null {
  const headers = readNativeValue<Headers>(request, RequestHeadersGet);
  return IntrinsicReflectApply(HeadersGet, headers, [name]) as string | null;
}

function hasNativeInstance(
  constructor:
    | typeof Headers
    | typeof Map
    | typeof Request
    | typeof Response
    | typeof Set
    | typeof URLSearchParams,
  value: unknown,
): boolean {
  return IntrinsicReflectApply(NativeHasInstance, constructor, [value]) as boolean;
}

function appendHeader(target: Headers, name: unknown, value: unknown): void {
  IntrinsicReflectApply(HeadersAppend, target, [NativeString(name), NativeString(value)]);
}

function appendHeaderEntry(target: Headers, entry: Iterable<unknown>): void {
  if (NativeArrayIsArray(entry)) {
    const nameDescriptor = ObjectGetOwnPropertyDescriptor(entry, 0);
    if (entry.length !== 2 || !nameDescriptor) {
      throw new TypeError("Header entry must contain a name and value");
    }
    const name = readDescriptorValue(entry, nameDescriptor);
    const valueDescriptor = ObjectGetOwnPropertyDescriptor(entry, 1);
    if (!valueDescriptor) throw new TypeError("Header entry must contain a name and value");
    appendHeader(
      target,
      name,
      readDescriptorValue(entry, valueDescriptor),
    );
    return;
  }

  const values = NativeArrayFrom(entry);
  if (values.length !== 2) {
    throw new TypeError("Header entry must contain a name and value");
  }
  appendHeader(target, values[0], values[1]);
}

function findPropertyBeforeObjectPrototype(
  source: PrototypeInspectable,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  let current: PrototypeInspectable | null = source;
  while (current !== null && current !== NativeObjectPrototype) {
    const descriptor = ObjectGetOwnPropertyDescriptor(current, property);
    if (descriptor) return descriptor;
    current = ObjectGetPrototypeOf(current) as PrototypeInspectable | null;
  }
  return undefined;
}

function readDescriptorValue(
  source: PrototypeInspectable,
  descriptor: PropertyDescriptor,
): unknown {
  if (ObjectHasOwn(descriptor, "get")) {
    return descriptor.get ? IntrinsicReflectApply(descriptor.get, source, []) : undefined;
  }
  return ObjectHasOwn(descriptor, "value") ? descriptor.value : undefined;
}

function copyHeaders(source: HeadersInit, target: Headers): void {
  if (hasNativeInstance(NativeHeaders, source)) {
    IntrinsicReflectApply(HeadersForEach, source, [
      (value: string, name: string) => appendHeader(target, name, value),
    ]);
    return;
  }

  if (NativeArrayIsArray(source)) {
    for (let index = 0; index < source.length; index++) {
      if (!ObjectHasOwn(source, index)) continue;
      appendHeaderEntry(target, source[index]!);
    }
    return;
  }

  if (hasNativeInstance(NativeMap, source)) {
    IntrinsicReflectApply(MapForEach, source, [
      (value: unknown, name: unknown) => appendHeader(target, name, value),
    ]);
    return;
  }

  if (hasNativeInstance(NativeSet, source)) {
    IntrinsicReflectApply(SetForEach, source, [
      (entry: Iterable<unknown>) => appendHeaderEntry(target, entry),
    ]);
    return;
  }

  if (hasNativeInstance(NativeURLSearchParams, source)) {
    IntrinsicReflectApply(URLSearchParamsForEach, source, [
      (value: string, name: string) => appendHeader(target, name, value),
    ]);
    return;
  }

  if (findPropertyBeforeObjectPrototype(source, SymbolIterator)) {
    const iterable = source as Iterable<string[]>;
    for (const entry of iterable) appendHeaderEntry(target, entry);
    return;
  }

  const names = ObjectKeys(source);
  const record = source as Record<string, string>;
  for (let index = 0; index < names.length; index++) {
    const name = names[index]!;
    appendHeader(target, name, record[name]);
  }
}

function replaceHeaders(source: HeadersInit, target: Headers): void {
  const normalized = new NativeHeaders();
  copyHeaders(source, normalized);
  const replaced: Record<string, true> = ObjectCreate(null);
  IntrinsicReflectApply(HeadersForEach, normalized, [
    (value: string, name: string) => {
      if (!ObjectHasOwn(replaced, name)) {
        IntrinsicReflectApply(HeadersDelete, target, [name]);
        replaced[name] = true;
      }
      IntrinsicReflectApply(HeadersAppend, target, [name, value]);
    },
  ]);
}

function readResponseValue<T>(
  response: Response,
  getter: (() => T) | undefined,
  property: "body" | "headers" | "status" | "statusText",
): T {
  if (hasNativeInstance(NativeResponse, response)) {
    return readNativeValue<T>(response, getter);
  }
  return response[property] as T;
}

function createNativeResponse(
  body: BodyInit | null,
  status?: number,
  statusText?: string,
): Response {
  if (status === undefined && statusText === undefined) return new NativeResponse(body);

  const init: ResponseInit = ObjectCreate(null);
  if (status !== undefined) init.status = status;
  if (statusText !== undefined) init.statusText = statusText;
  return new NativeResponse(body, init);
}

function copyRequestInit(init: RequestInit): RequestInit {
  const copy: RequestInit = ObjectCreate(null);
  if (hasNativeInstance(NativeRequest, init)) {
    const request = init as Request;
    for (let index = 0; index < RequestInitFields.length; index++) {
      const field = RequestInitFields[index]!;
      const getter = RequestInitGetters[field];
      if (!getter) continue;
      const value = readNativeValue<unknown>(request, getter);
      if (field === "body" && value === null) continue;
      IntrinsicReflectSet(copy, field, value);
    }
    return copy;
  }

  for (let index = 0; index < RequestInitFields.length; index++) {
    const field = RequestInitFields[index]!;
    const descriptor = findPropertyBeforeObjectPrototype(init, field);
    if (!descriptor) continue;
    const value = readDescriptorValue(init, descriptor);
    IntrinsicReflectSet(copy, field, value);
  }
  return copy;
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
    const serverDescriptor = findPropertyBeforeObjectPrototype(contract, "server");
    return {
      serviceName: contract.serviceName,
      agents: contract.agents,
      defaultAgentId: contract.defaultAgentId,
      server: serverDescriptor
        ? readDescriptorValue(contract, serverDescriptor) as AgentServiceServerConfig | undefined
        : undefined,
      durableRunSink: contract.durableRunSink,
    };
  }

  const defaultAgentId = getSingleAgentDefaultId(contract);
  const serverDescriptor = findPropertyBeforeObjectPrototype(contract, "server");
  return {
    serviceName: contract.serviceName,
    agents: { [defaultAgentId]: contract.agent },
    defaultAgentId,
    server: serverDescriptor
      ? readDescriptorValue(contract, serverDescriptor) as AgentServiceServerConfig | undefined
      : undefined,
    durableRunSink: contract.durableRunSink,
  };
}

function normalizePath(path: string): string {
  if (path === "") return "/";
  return IntrinsicReflectApply(StringStartsWith, path, ["/"]) ? path : `/${path}`;
}

function splitPath(path: string): { length: number; [index: number]: string } {
  const normalized = normalizePath(path);
  // A private, prototype-free list avoids replaceable string split hooks and
  // Array species/iterators during route matching.
  const parts = { __proto__: null, length: 0 } as { length: number; [index: number]: string };
  let start = 0;
  while (start < normalized.length) {
    const separator = IntrinsicReflectApply(StringIndexOf, normalized, ["/", start]) as number;
    const end = separator === -1 ? normalized.length : separator;
    if (end > start) {
      parts[parts.length++] = IntrinsicReflectApply(StringSlice, normalized, [
        start,
        end,
      ]) as string;
    }
    start = end + 1;
  }
  return parts;
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
  for (let index = 0; index < routeParts.length; index++) {
    const routePart = routeParts[index]!;
    const requestPart = requestParts[index];
    if (requestPart === undefined) {
      return undefined;
    }

    if (IntrinsicReflectApply(StringStartsWith, routePart, [":"])) {
      const descriptor: PropertyDescriptor = ObjectCreate(null);
      descriptor.value = NativeDecodeURIComponent(requestPart);
      descriptor.writable = true;
      descriptor.enumerable = true;
      descriptor.configurable = true;
      ObjectDefineProperty(
        params,
        IntrinsicReflectApply(StringSlice, routePart, [1]) as string,
        descriptor,
      );
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
  if (!server) return undefined;
  const corsDescriptor = findPropertyBeforeObjectPrototype(server, "cors");
  if (!corsDescriptor) return undefined;
  const cors = readDescriptorValue(server, corsDescriptor) as AgentServiceServerConfig["cors"];
  if (!cors) return undefined;
  const normalized: AgentServiceCorsConfig = ObjectCreate(null);
  if (cors === true) {
    normalized.origins = ["*"];
    return normalized;
  }
  if (typeof cors !== "object") return undefined;
  const origins = findPropertyBeforeObjectPrototype(cors, "origins");
  const credentials = findPropertyBeforeObjectPrototype(cors, "credentials");
  const allowMethods = findPropertyBeforeObjectPrototype(cors, "allowMethods");
  const allowHeaders = findPropertyBeforeObjectPrototype(cors, "allowHeaders");
  const maxAgeSeconds = findPropertyBeforeObjectPrototype(cors, "maxAgeSeconds");
  if (origins) normalized.origins = readDescriptorValue(cors, origins) as string[] | undefined;
  if (credentials) {
    normalized.credentials = readDescriptorValue(cors, credentials) as boolean | undefined;
  }
  if (allowMethods) {
    normalized.allowMethods = readDescriptorValue(cors, allowMethods) as
      | AgentServiceRouteMethod[]
      | undefined;
  }
  if (allowHeaders) {
    normalized.allowHeaders = readDescriptorValue(cors, allowHeaders) as string[] | undefined;
  }
  if (maxAgeSeconds) {
    normalized.maxAgeSeconds = readDescriptorValue(cors, maxAgeSeconds) as number | undefined;
  }
  return normalized;
}

function joinOwnPolicyEntries(values: readonly string[]): string {
  let result = "";
  let first = true;
  for (let index = 0; index < values.length; index++) {
    if (!ObjectHasOwn(values, index)) continue;
    if (!first) result += ", ";
    first = false;
    const value = values[index];
    if (value !== undefined && value !== null) result += NativeString(value);
  }
  return result;
}

function includesOwnOrigin(origins: string[], value: string): boolean {
  for (let index = 0; index < origins.length; index++) {
    if (ObjectHasOwn(origins, index) && origins[index] === value) return true;
  }
  return false;
}

function getAllowedCorsOrigin(
  config: AgentServiceCorsConfig,
  request: Request,
): string | undefined {
  const origin = readRequestHeader(request, "Origin");
  if (!origin) return undefined;

  const origins = config.origins ?? ["*"];
  if (includesOwnOrigin(origins, "*")) {
    return config.credentials ? origin : "*";
  }

  return includesOwnOrigin(origins, origin) ? origin : undefined;
}

function appendCorsHeaders(
  headers: Headers,
  config: AgentServiceCorsConfig,
  request: Request,
): void {
  const allowedOrigin = getAllowedCorsOrigin(config, request);
  if (!allowedOrigin) return;

  IntrinsicReflectApply(HeadersSet, headers, ["Access-Control-Allow-Origin", allowedOrigin]);
  IntrinsicReflectApply(HeadersAppend, headers, ["Vary", "Origin"]);

  if (config.credentials) {
    IntrinsicReflectApply(HeadersSet, headers, ["Access-Control-Allow-Credentials", "true"]);
  }
}

function createCorsPreflightResponse(
  request: Request,
  config: AgentServiceCorsConfig,
): Response {
  const response = createNativeResponse(null, 204);
  const headers = readNativeValue<Headers>(response, ResponseHeadersGet);
  appendCorsHeaders(headers, config, request);

  const allowMethods = config.allowMethods ?? ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
  IntrinsicReflectApply(HeadersSet, headers, [
    "Access-Control-Allow-Methods",
    joinOwnPolicyEntries(allowMethods),
  ]);

  const requestedHeaders = readRequestHeader(request, "Access-Control-Request-Headers");
  const allowHeaders = config.allowHeaders
    ? joinOwnPolicyEntries(config.allowHeaders)
    : requestedHeaders;
  if (allowHeaders) {
    IntrinsicReflectApply(HeadersSet, headers, ["Access-Control-Allow-Headers", allowHeaders]);
  }

  if (config.maxAgeSeconds !== undefined) {
    IntrinsicReflectApply(HeadersSet, headers, [
      "Access-Control-Max-Age",
      NativeString(config.maxAgeSeconds),
    ]);
  }

  return response;
}

function withCorsHeaders(
  response: Response,
  config: AgentServiceCorsConfig | undefined,
  request: Request,
): Response {
  if (!config) return response;

  const result = createNativeResponse(
    readResponseValue<ReadableStream<Uint8Array> | null>(response, ResponseBodyGet, "body"),
    readResponseValue<number>(response, ResponseStatusGet, "status"),
    readResponseValue<string>(response, ResponseStatusTextGet, "statusText"),
  );
  const headers = readNativeValue<Headers>(result, ResponseHeadersGet);
  copyHeaders(readResponseValue<HeadersInit>(response, ResponseHeadersGet, "headers"), headers);
  appendCorsHeaders(headers, config, request);
  return result;
}

function toRuntimeRequest(input: string | URL | Request, init?: RequestInit): Request {
  const createRequest = (requestInput: string | Request): Request => {
    if (init === undefined) return new NativeRequest(requestInput);

    const requestInit = copyRequestInit(init);
    if (!ObjectHasOwn(requestInit, "headers") || requestInit.headers === undefined) {
      return new NativeRequest(requestInput, requestInit);
    }

    const headers = requestInit.headers;
    requestInit.headers = EmptyHeadersInit;
    const request = new NativeRequest(requestInput, requestInit);
    const requestHeaders = readNativeValue<Headers>(request, RequestHeadersGet);
    replaceHeaders(headers, requestHeaders);
    return request;
  };

  if (hasNativeInstance(NativeRequest, input)) {
    return init === undefined ? input as Request : createRequest(input as Request);
  }

  const requestUrl = typeof input === "string" ? new NativeURL(input, "http://localhost") : input;
  return createRequest(readNativeValue<string>(requestUrl, URLHrefGet));
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
  const routesDescriptor = findPropertyBeforeObjectPrototype(options, "routes");
  const routes = routesDescriptor
    ? readDescriptorValue(options, routesDescriptor) as AgentServiceRoute[] | undefined ?? []
    : [];
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
          ? createNativeResponse("Shutting down", 503)
          : createNativeResponse("OK");
        return withCorsHeaders(response, corsConfig, request);
      }
      if (method === "GET" && path === "/liveness") {
        response = createNativeResponse("OK");
        return withCorsHeaders(response, corsConfig, request);
      }

      // Never hand the host route table to project-replaceable iterators:
      // an injected route would receive the original credentialed request.
      for (let index = 0; index < routes.length; index++) {
        if (!ObjectHasOwn(routes, index)) continue;
        const route = routes[index]!;
        const params = matchRoute(route, method, path);
        if (params) {
          response = await route.handler(request, params);
          return withCorsHeaders(response, corsConfig, request);
        }
      }

      response = createNativeResponse("Not Found", 404);
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
