/**
 * OpenAPI MCP Tools Generator
 *
 * Auto-generates MCP tools from OpenAPI specification, allowing AI agents
 * to call API endpoints directly.
 *
 * @module routing/api/openapi/mcp-tools
 */

import { dynamicTool } from "#veryfront/tool";
import type { Tool, ToolExecutionContext } from "#veryfront/tool";
import { logger as baseLogger } from "#veryfront/utils";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import { NETWORK_ERROR, TIMEOUT_ERROR } from "#veryfront/errors";
import { snapshotThrowableDiagnostic } from "#veryfront/errors/safe-diagnostics.ts";
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import type { Schema, SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import type { OpenAPIOperation, OpenAPIParameter, OpenAPISpec } from "./types.ts";

const logger = baseLogger.component("open-api-mcp");

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_CONFIGURED_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_GENERATED_TOOLS = 1_000;
const MAX_PARAMETERS_PER_OPERATION = 512;
const MAX_BASE_URL_LENGTH = 8_192;
const MAX_PATH_LENGTH = 4_096;
const MAX_TOOL_PREFIX_LENGTH = 128;
const MAX_OPERATION_ID_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 8_192;
const MAX_HEADER_COUNT = 128;
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_TIMEOUT_MS = 5 * 60_000;
const UTF8_ENCODER = new TextEncoder();
const abortSignalAbortedGetter = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "aborted",
)?.get;
const abortSignalReasonGetter = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  "reason",
)?.get;
const abortSignalThrowIfAborted = AbortSignal.prototype.throwIfAborted;
const eventTargetAddEventListener = EventTarget.prototype.addEventListener;
const eventTargetRemoveEventListener = EventTarget.prototype.removeEventListener;

class OpenAPIMCPResponseError extends TypeError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OpenAPIMCPResponseError";
  }
}

function isHttpMethod(method: string): method is HttpMethod {
  return HTTP_METHODS.includes(method as HttpMethod);
}

/**
 * Configuration for MCP tools generation.
 */
export interface MCPToolsConfig {
  /** Base URL for API calls (e.g., "http://localhost:3000") */
  baseUrl: string;
  /** Tool naming prefix (default: "api") */
  toolPrefix?: string;
  /** Fixed headers included after per-call headers, so credentials cannot be overridden. */
  headers?: Record<string, string>;
  /** Optional fetch implementation captured when tools are generated. */
  fetch?: typeof fetch;
  /** Per-request deadline in milliseconds (default: 30 seconds). */
  timeoutMs?: number;
  /** Maximum decoded response body in bytes (default: 4 MiB, maximum: 16 MiB). */
  maxResponseBytes?: number;
}

interface CapturedMCPToolsConfig {
  baseUrlPrefix: string;
  basePath: string;
  toolPrefix: string;
  headers: ReadonlyArray<readonly [string, string]>;
  fetch: typeof fetch;
  timeoutMs: number;
  maxResponseBytes: number;
}

function invalidConfig(message: string): TypeError {
  return new TypeError(`OpenAPI MCP ${message}`);
}

function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function readOwnDataProperty(
  value: object,
  key: PropertyKey,
  label: string,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Reflect.getOwnPropertyDescriptor(value, key);
  } catch {
    throw invalidConfig(`${label} must contain only own data properties`);
  }
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) {
    throw invalidConfig(`${label} must contain only own data properties`);
  }
  return descriptor.value;
}

function requireBoundedText(
  value: unknown,
  label: string,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    hasControlCharacters(value)
  ) {
    throw invalidConfig(
      `${label} must be a non-empty, control-free string no longer than ${maxLength} characters`,
    );
  }
  return value;
}

function normalizeBaseUrl(value: unknown): {
  prefix: string;
  basePath: string;
} {
  const text = requireBoundedText(value, "baseUrl", MAX_BASE_URL_LENGTH);
  let url: URL;
  try {
    url = new URL(text);
  } catch (cause) {
    throw invalidConfig(
      `baseUrl must be an absolute HTTP(S) URL: ${snapshotThrowableDiagnostic(cause)}`,
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw invalidConfig(
      "baseUrl must be an absolute HTTP(S) URL without credentials, query, or fragment",
    );
  }

  const basePath = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  url.pathname = basePath || "/";
  const serialized = url.toString();
  return {
    prefix: serialized.endsWith("/") ? serialized.slice(0, -1) : serialized,
    basePath,
  };
}

function snapshotHeaders(value: unknown, label: string): ReadonlyArray<readonly [string, string]> {
  if (value === undefined) return Object.freeze([]);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidConfig(`${label} must be a record of string header values`);
  }

  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    throw invalidConfig(`${label} must contain only own data properties`);
  }
  const stringKeys = keys.filter((key): key is string => typeof key === "string");
  if (keys.length !== stringKeys.length || stringKeys.length > MAX_HEADER_COUNT) {
    throw invalidConfig(`${label} must contain at most ${MAX_HEADER_COUNT} string-keyed headers`);
  }

  const headers = new Headers();
  let byteCount = 0;
  for (const key of stringKeys) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    } catch {
      throw invalidConfig(`${label} must contain only own data properties`);
    }
    if (!descriptor || !descriptor.enumerable) continue;
    if (!("value" in descriptor) || typeof descriptor.value !== "string") {
      throw invalidConfig(`${label}.${key} must be an own string data property`);
    }
    byteCount += UTF8_ENCODER.encode(key).byteLength;
    byteCount += UTF8_ENCODER.encode(descriptor.value).byteLength;
    if (byteCount > MAX_HEADER_BYTES) {
      throw invalidConfig(`${label} exceeds the ${MAX_HEADER_BYTES}-byte limit`);
    }
    try {
      headers.set(key, descriptor.value);
    } catch (cause) {
      throw invalidConfig(
        `${label} contains an invalid header: ${snapshotThrowableDiagnostic(cause)}`,
      );
    }
  }

  const entries = Array.from(
    headers.entries(),
    ([key, entry]) => Object.freeze([key, entry] as const),
  );
  return Object.freeze(entries);
}

function requireBoundedInteger(
  value: unknown,
  fallback: number,
  label: string,
  maximum: number,
): number {
  const resolved = value === undefined ? fallback : value;
  if (
    typeof resolved !== "number" ||
    !Number.isSafeInteger(resolved) ||
    resolved <= 0 ||
    resolved > maximum
  ) {
    throw invalidConfig(`${label} must be a positive integer no greater than ${maximum}`);
  }
  return resolved;
}

function captureConfig(config: MCPToolsConfig): CapturedMCPToolsConfig {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw invalidConfig("configuration must be an object");
  }

  const { prefix, basePath } = normalizeBaseUrl(
    readOwnDataProperty(config, "baseUrl", "configuration"),
  );
  const configuredPrefix = readOwnDataProperty(config, "toolPrefix", "configuration");
  const configuredFetch = readOwnDataProperty(config, "fetch", "configuration");
  if (configuredFetch !== undefined && typeof configuredFetch !== "function") {
    throw invalidConfig("fetch must be a function");
  }
  const fetchImpl = configuredFetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw invalidConfig("fetch must be available when tools are generated");
  }

  return Object.freeze({
    baseUrlPrefix: prefix,
    basePath,
    toolPrefix: configuredPrefix === undefined
      ? "api"
      : requireBoundedText(configuredPrefix, "toolPrefix", MAX_TOOL_PREFIX_LENGTH),
    headers: snapshotHeaders(
      readOwnDataProperty(config, "headers", "configuration"),
      "headers",
    ),
    fetch: fetchImpl as typeof fetch,
    timeoutMs: requireBoundedInteger(
      readOwnDataProperty(config, "timeoutMs", "configuration"),
      DEFAULT_REQUEST_TIMEOUT_MS,
      "timeoutMs",
      MAX_TIMEOUT_MS,
    ),
    maxResponseBytes: requireBoundedInteger(
      readOwnDataProperty(config, "maxResponseBytes", "configuration"),
      DEFAULT_MAX_RESPONSE_BYTES,
      "maxResponseBytes",
      MAX_CONFIGURED_RESPONSE_BYTES,
    ),
  });
}

function snapshotSpec(spec: OpenAPISpec): OpenAPISpec {
  const snapshot = snapshotBoundedJsonValue(spec);
  if (
    !snapshot.success ||
    typeof snapshot.value !== "object" ||
    snapshot.value === null ||
    Array.isArray(snapshot.value)
  ) {
    throw invalidConfig("specification must be a bounded data-only JSON object");
  }
  return snapshot.value as unknown as OpenAPISpec;
}

function validateOperation(
  operation: OpenAPIOperation,
  method: string,
  path: string,
): string {
  if (typeof operation !== "object" || operation === null || Array.isArray(operation)) {
    throw invalidConfig(`${method.toUpperCase()} ${path} operation must be an object`);
  }
  const operationId = requireBoundedText(
    operation.operationId,
    `${method.toUpperCase()} ${path} operationId`,
    MAX_OPERATION_ID_LENGTH,
  );
  if (
    (operation.summary !== undefined && typeof operation.summary !== "string") ||
    (operation.description !== undefined && typeof operation.description !== "string") ||
    (operation.tags !== undefined &&
      (!Array.isArray(operation.tags) ||
        operation.tags.some((tag) => typeof tag !== "string")))
  ) {
    throw invalidConfig(`${method.toUpperCase()} ${path} contains invalid descriptive metadata`);
  }
  if (
    operation.parameters !== undefined &&
    (!Array.isArray(operation.parameters) ||
      operation.parameters.length > MAX_PARAMETERS_PER_OPERATION)
  ) {
    throw invalidConfig(
      `${method.toUpperCase()} ${path} parameters must contain at most ${MAX_PARAMETERS_PER_OPERATION} entries`,
    );
  }

  const parameterSlots = new Set<string>();
  for (const parameter of operation.parameters ?? []) {
    if (
      typeof parameter !== "object" ||
      parameter === null ||
      Array.isArray(parameter) ||
      typeof parameter.name !== "string" ||
      parameter.name.length === 0 ||
      parameter.name.length > 256 ||
      !["path", "query", "header", "cookie"].includes(parameter.in)
    ) {
      throw invalidConfig(`${method.toUpperCase()} ${path} contains an invalid parameter`);
    }
    const slotName = parameter.in === "header" ? parameter.name.toLowerCase() : parameter.name;
    const slot = `${parameter.in}:${slotName}`;
    if (parameterSlots.has(slot)) {
      throw invalidConfig(`${method.toUpperCase()} ${path} contains duplicate parameter ${slot}`);
    }
    parameterSlots.add(slot);
    if (
      parameter.in === "path" &&
      (parameter.name === "query" || parameter.name === "headers" || parameter.name === "body")
    ) {
      throw invalidConfig(
        `${method.toUpperCase()} ${path} path parameter "${parameter.name}" conflicts with a tool input group`,
      );
    }
    if (parameter.in === "path" && parameter.required !== true) {
      throw invalidConfig(
        `${method.toUpperCase()} ${path} path parameter "${parameter.name}" must be required`,
      );
    }
  }

  const pathParameterNames = new Set(
    (operation.parameters ?? [])
      .filter((parameter) => parameter.in === "path")
      .map((parameter) => parameter.name),
  );
  const templateNames = Array.from(path.matchAll(/\{([^{}]+)\}/g), (match) => match[1]!);
  if (
    templateNames.some((name) => !pathParameterNames.has(name)) ||
    Array.from(pathParameterNames).some((name) => !templateNames.includes(name))
  ) {
    throw invalidConfig(
      `${method.toUpperCase()} ${path} path parameters must exactly match its template`,
    );
  }
  return operationId;
}

/**
 * Generate MCP tools from an OpenAPI specification.
 *
 * Each API endpoint becomes a callable tool that AI agents can invoke.
 */
export function generateMCPToolsFromSpec(spec: OpenAPISpec, config: MCPToolsConfig): Tool[] {
  const capturedConfig = captureConfig(config);
  const capturedSpec = snapshotSpec(spec);
  const tools: Tool[] = [];
  const toolIds = new Set<string>();

  if (
    typeof capturedSpec.paths !== "object" ||
    capturedSpec.paths === null ||
    Array.isArray(capturedSpec.paths)
  ) {
    throw invalidConfig("specification paths must be an object");
  }

  for (const [path, pathItem] of Object.entries(capturedSpec.paths)) {
    if (!pathItem) continue;
    validateOpenAPIPath(path);
    if (typeof pathItem !== "object" || Array.isArray(pathItem)) {
      throw invalidConfig(`path item "${path}" must be an object`);
    }

    for (const [method, operationValue] of Object.entries(pathItem)) {
      if (!isHttpMethod(method)) continue;

      const operation = operationValue as OpenAPIOperation | undefined;
      if (!operation) continue;
      const operationId = validateOperation(operation, method, path);
      const toolId = `${capturedConfig.toolPrefix}:${operationId}`;
      if (toolIds.has(toolId)) {
        throw invalidConfig(`specification generated duplicate tool id "${toolId}"`);
      }
      if (tools.length >= MAX_GENERATED_TOOLS) {
        throw invalidConfig(
          `specification cannot generate more than ${MAX_GENERATED_TOOLS} tools`,
        );
      }
      toolIds.add(toolId);

      tools.push(
        dynamicTool({
          id: toolId,
          description: buildToolDescription(operation, method, path),
          inputSchema: buildInputSchema(operation),
          execute: (input, context?) =>
            executeAPICall(
              capturedConfig,
              method,
              path,
              input as Record<string, unknown>,
              operation,
              context,
            ),
          mcp: { enabled: true },
        }),
      );
    }
  }

  logger.debug("Generated tools", { count: tools.length });
  return tools;
}

function buildToolDescription(operation: OpenAPIOperation, method: string, path: string): string {
  const summary = operation.summary ?? `${method.toUpperCase()} ${path}`;
  const description = operation.description ? `\n\n${operation.description}` : "";
  const tags = operation.tags?.length ? `\n\nTags: ${operation.tags.join(", ")}` : "";
  const deprecated = operation.deprecated ? "\n\n⚠️ DEPRECATED" : "";

  const result = `${summary}${description}${tags}${deprecated}`;
  if (
    result.length > MAX_DESCRIPTION_LENGTH
  ) {
    throw invalidConfig(
      `${method.toUpperCase()} ${path} description must be valid text no longer than ${MAX_DESCRIPTION_LENGTH} characters`,
    );
  }
  return result;
}

function buildInputSchema(operation: OpenAPIOperation): Schema<unknown> {
  return lazySchema(defineSchema((v) => {
    const shape: Record<string, Schema<unknown>> = Object.create(null);
    const params = operation.parameters ?? [];

    for (const param of params) {
      if (param.in !== "path") continue;
      shape[param.name] = withRequired(buildParamSchema(v, param), param.required);
    }

    addParamGroup(v, shape, params, "query", "query", "Query parameters");
    addParamGroup(v, shape, params, "header", "headers", "Request headers");

    if (operation.requestBody) {
      shape.body = v.record(v.string(), v.unknown()).optional().describe("Request body (JSON)");
    }

    return v.object(shape);
  }));
}

function addParamGroup(
  v: SchemaValidator,
  shape: Record<string, Schema<unknown>>,
  params: OpenAPIParameter[],
  paramIn: "query" | "header",
  key: "query" | "headers",
  description: string,
): void {
  const groupParams = params.filter((p) => p.in === paramIn);
  if (!groupParams.length) return;

  const groupShape: Record<string, Schema<unknown>> = Object.create(null);
  for (const param of groupParams) {
    groupShape[param.name] = withRequired(buildParamSchema(v, param), param.required);
  }

  shape[key] = v.object(groupShape).optional().describe(description);
}

function withRequired(schema: Schema<unknown>, required?: boolean): Schema<unknown> {
  return required ? schema : schema.optional();
}

function buildParamSchema(
  v: SchemaValidator,
  param: OpenAPIParameter,
): Schema<unknown> {
  const schema = param.schema;
  if (!schema) return v.string();

  switch (schema.type) {
    case "integer":
    case "number":
      return v.coerce.number();
    case "boolean":
      return v.coerce.boolean();
    case "array":
      return v.array(v.string());
    default:
      return v.string();
  }
}

function validateOpenAPIPath(path: string): void {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.length > MAX_PATH_LENGTH ||
    !path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#") ||
    hasControlCharacters(path) ||
    /(?:^|\/)(?:\.{1,2}|%2e(?:%2e)?)(?:\/|$)/i.test(path)
  ) {
    throw invalidConfig(
      `path must be an absolute, control-free route no longer than ${MAX_PATH_LENGTH} characters`,
    );
  }
}

function requireInputRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidConfig(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireParameterText(value: unknown, label: string): string {
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw invalidConfig(`${label} must be a string, finite number, or boolean`);
}

function appendQueryValue(
  searchParams: URLSearchParams,
  key: string,
  value: unknown,
): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    for (const entry of value) {
      searchParams.append(key, requireParameterText(entry, `query.${key}`));
    }
    return;
  }
  searchParams.append(key, requireParameterText(value, `query.${key}`));
}

function buildRequestUrl(
  config: CapturedMCPToolsConfig,
  path: string,
  input: Record<string, unknown>,
  operation: OpenAPIOperation,
): URL {
  let resolvedPath = path;
  for (const parameter of operation.parameters ?? []) {
    if (parameter.in !== "path") continue;
    const value = readOwnDataProperty(input, parameter.name, "tool input");
    if (value === undefined) {
      throw invalidConfig(`path parameter "${parameter.name}" is required`);
    }
    const token = `{${parameter.name}}`;
    resolvedPath = resolvedPath.split(token).join(
      encodeURIComponent(requireParameterText(value, `path parameter ${parameter.name}`)),
    );
  }
  if (/\{[^{}]+\}/.test(resolvedPath)) {
    throw invalidConfig(`path "${path}" contains an unresolved parameter`);
  }

  let url: URL;
  try {
    url = new URL(`${config.baseUrlPrefix}${resolvedPath}`);
  } catch (cause) {
    throw invalidConfig(`request URL is invalid: ${snapshotThrowableDiagnostic(cause)}`);
  }
  if (
    config.basePath &&
    url.pathname !== config.basePath &&
    !url.pathname.startsWith(`${config.basePath}/`)
  ) {
    throw invalidConfig(`path "${path}" escapes the configured base path`);
  }

  const rawQuery = readOwnDataProperty(input, "query", "tool input");
  if (rawQuery !== undefined) {
    const querySnapshot = snapshotBoundedJsonValue(
      requireInputRecord(rawQuery, "query"),
    );
    if (
      !querySnapshot.success ||
      typeof querySnapshot.value !== "object" ||
      querySnapshot.value === null ||
      Array.isArray(querySnapshot.value)
    ) {
      throw invalidConfig("query must be a bounded data-only object");
    }
    for (const [key, value] of Object.entries(querySnapshot.value)) {
      appendQueryValue(url.searchParams, key, value);
    }
  }
  return url;
}

function buildRequestHeaders(
  config: CapturedMCPToolsConfig,
  input: Record<string, unknown>,
): Headers {
  const headers = new Headers();
  const inputHeaders = snapshotHeaders(
    readOwnDataProperty(input, "headers", "tool input"),
    "tool input headers",
  );
  for (const [key, value] of inputHeaders) headers.set(key, value);
  for (const [key, value] of config.headers) headers.set(key, value);
  headers.set("content-type", "application/json");
  return headers;
}

function buildRequestBody(method: string, input: Record<string, unknown>): string | undefined {
  if (method !== "post" && method !== "put" && method !== "patch") return undefined;
  const rawBody = readOwnDataProperty(input, "body", "tool input");
  if (rawBody === undefined) return undefined;

  const snapshot = snapshotBoundedJsonValue(rawBody);
  if (!snapshot.success) {
    throw invalidConfig("request body must be a bounded data-only JSON value");
  }
  return JSON.stringify(snapshot.value);
}

function readAbortSignalAborted(signal: AbortSignal): boolean {
  if (!abortSignalAbortedGetter) {
    throw invalidConfig("AbortSignal runtime contract is unavailable");
  }
  return Reflect.apply(abortSignalAbortedGetter, signal, []);
}

function readAbortSignalReason(signal: AbortSignal): unknown {
  return abortSignalReasonGetter ? Reflect.apply(abortSignalReasonGetter, signal, []) : undefined;
}

function validateAbortSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null) {
    throw invalidConfig("execution abortSignal must be an AbortSignal");
  }
  try {
    readAbortSignalAborted(value as AbortSignal);
  } catch {
    throw invalidConfig("execution abortSignal must be an AbortSignal");
  }
  return value as AbortSignal;
}

function readExecutionAbortSignal(
  context: ToolExecutionContext | undefined,
): AbortSignal | undefined {
  if (context === undefined) return undefined;
  if (typeof context !== "object" || context === null || Array.isArray(context)) {
    throw invalidConfig("execution context must be an object");
  }
  return validateAbortSignal(
    readOwnDataProperty(context, "abortSignal", "execution context"),
  );
}

interface RequestSignalScope {
  signal: AbortSignal;
  timedOut(): boolean;
  dispose(): void;
}

function createRequestSignalScope(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): RequestSignalScope {
  if (callerSignal) {
    Reflect.apply(abortSignalThrowIfAborted, callerSignal, []);
  }

  const controller = new AbortController();
  let timeoutTriggered = false;
  const forwardCallerAbort = () => controller.abort(readAbortSignalReason(callerSignal!));
  const timeoutId = setTimeout(() => {
    timeoutTriggered = true;
    controller.abort(new DOMException("OpenAPI MCP request timed out", "TimeoutError"));
  }, timeoutMs);

  if (callerSignal) {
    Reflect.apply(eventTargetAddEventListener, callerSignal, [
      "abort",
      forwardCallerAbort,
      { once: true },
    ]);
    if (readAbortSignalAborted(callerSignal)) forwardCallerAbort();
  }

  let disposed = false;
  return {
    signal: controller.signal,
    timedOut: () => timeoutTriggered,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timeoutId);
      if (callerSignal) {
        Reflect.apply(eventTargetRemoveEventListener, callerSignal, [
          "abort",
          forwardCallerAbort,
        ]);
      }
    },
  };
}

function cancelResponseBody(response: Response): void {
  if (!response.body) return;
  try {
    const cancellation = response.body.cancel();
    void cancellation.catch(() => {});
  } catch {
    // Best-effort cleanup after rejecting a response at its metadata boundary.
  }
}

function fetchWithAbortBoundary(
  fetchImpl: typeof fetch,
  url: URL,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> {
  if (readAbortSignalAborted(signal)) {
    return Promise.reject(readAbortSignalReason(signal));
  }

  let fetchPromise: Promise<Response>;
  try {
    fetchPromise = Reflect.apply(fetchImpl, undefined, [url, init]);
  } catch (error) {
    return Promise.reject(error);
  }

  return new Promise<Response>((resolve, reject) => {
    let settled = false;
    const removeAbortListener = () => {
      Reflect.apply(eventTargetRemoveEventListener, signal, ["abort", onAbort]);
    };
    const onAbort = () => {
      if (settled) return;
      settled = true;
      removeAbortListener();
      reject(readAbortSignalReason(signal));
    };

    Reflect.apply(eventTargetAddEventListener, signal, [
      "abort",
      onAbort,
      { once: true },
    ]);
    if (readAbortSignalAborted(signal)) onAbort();

    Promise.resolve(fetchPromise).then(
      (response) => {
        if (settled) {
          cancelResponseBody(response);
          return;
        }
        settled = true;
        removeAbortListener();
        resolve(response);
      },
      (error) => {
        if (settled) return;
        settled = true;
        removeAbortListener();
        reject(error);
      },
    );
  });
}

function parseContentLength(response: Response): number | undefined {
  const value = response.headers.get("content-length");
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

async function readResponseData(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<unknown> {
  const contentLength = parseContentLength(response);
  if (contentLength !== undefined && contentLength > maxBytes) {
    cancelResponseBody(response);
    throw new OpenAPIMCPResponseError(
      `OpenAPI MCP response exceeds the ${maxBytes}-byte limit`,
    );
  }

  let text: string;
  try {
    const result = await readResponseTextPrefix(response, maxBytes + 1, signal, {
      fatalUtf8: true,
    });
    if (result.truncated || UTF8_ENCODER.encode(result.text).byteLength > maxBytes) {
      throw new OpenAPIMCPResponseError(
        `OpenAPI MCP response exceeds the ${maxBytes}-byte limit`,
      );
    }
    text = result.text;
  } catch (cause) {
    if (cause instanceof OpenAPIMCPResponseError) throw cause;
    throw new OpenAPIMCPResponseError("OpenAPI MCP response body is invalid", { cause });
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!/(?:^|[;\s])application\/(?:[a-z0-9.+-]*\+)?json(?:[;\s]|$)/i.test(contentType)) {
    return text;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new OpenAPIMCPResponseError("OpenAPI MCP response contains malformed JSON", {
      cause,
    });
  }
  const snapshot = snapshotBoundedJsonValue(parsed);
  if (!snapshot.success) {
    throw new OpenAPIMCPResponseError("OpenAPI MCP response contains unbounded JSON");
  }
  return snapshot.value;
}

async function executeAPICall(
  config: CapturedMCPToolsConfig,
  method: string,
  path: string,
  input: Record<string, unknown>,
  operation: OpenAPIOperation,
  context?: ToolExecutionContext,
): Promise<unknown> {
  const callerSignal = readExecutionAbortSignal(context);
  const canonicalInput = requireInputRecord(input, "tool input");
  const url = buildRequestUrl(config, path, canonicalInput, operation);
  const headers = buildRequestHeaders(config, canonicalInput);
  const body = buildRequestBody(method, canonicalInput);
  const requestScope = createRequestSignalScope(callerSignal, config.timeoutMs);
  const requestInit: RequestInit = {
    method: method.toUpperCase(),
    headers,
    body,
    signal: requestScope.signal,
    redirect: "error",
  };

  try {
    logger.debug("Executing API call", { method, url: url.toString() });
    const response = await fetchWithAbortBoundary(
      config.fetch,
      url,
      requestInit,
      requestScope.signal,
    );
    const data = await readResponseData(
      response,
      config.maxResponseBytes,
      requestScope.signal,
    );

    return {
      status: response.status,
      statusText: response.statusText,
      data,
    };
  } catch (error) {
    if (requestScope.timedOut()) {
      throw TIMEOUT_ERROR.create({
        detail: `OpenAPI MCP request timed out after ${config.timeoutMs}ms`,
      });
    }
    if (readAbortSignalAborted(requestScope.signal)) {
      const reason = readAbortSignalReason(requestScope.signal);
      if (reason !== undefined) throw reason;
      throw NETWORK_ERROR.create({ detail: "OpenAPI MCP request was aborted" });
    }
    if (error instanceof OpenAPIMCPResponseError) throw error;

    const message = snapshotThrowableDiagnostic(error);
    logger.error("API call failed", { method, url: url.toString(), error: message });
    return {
      error: true,
      message,
    };
  } finally {
    requestScope.dispose();
  }
}
