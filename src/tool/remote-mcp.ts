import {
  getErrorMessage,
  INPUT_VALIDATION_FAILED,
  INVALID_ARGUMENT,
  NETWORK_ERROR,
  TIMEOUT_ERROR,
} from "#veryfront/errors";
import type { ToolAnnotations } from "#veryfront/mcp/annotations.ts";
import type { JsonSchema } from "./schema/json-schema.ts";
import { hasToolExecutionErrorMarker } from "./result.ts";
import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "./types.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import { snapshotJsonValue } from "./json-value.ts";

/** Default timeout for a single outbound remote MCP request. */
const DEFAULT_REMOTE_MCP_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_REMOTE_MCP_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_REMOTE_MCP_MAX_REQUEST_BYTES = 1024 * 1024;
// Keep one byte available when reading a bounded prefix so an exactly-at-limit
// response can be distinguished from an oversized response.
const MAX_REMOTE_MCP_BODY_BYTES = 16 * 1024 * 1024 - 1;
const MAX_REMOTE_MCP_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
/** Upper bound on characters inspected when classifying a remote HTTP failure. */
const MAX_ERROR_BODY_LENGTH = 2_000;
const MAX_ERROR_BODY_BYTES = MAX_ERROR_BODY_LENGTH * 4;
/** Defensive cap on tools/list pagination to avoid unbounded cursor loops. */
const DEFAULT_MAX_TOOL_LIST_PAGES = 50;
const MAX_CONFIGURED_TOOL_LIST_PAGES = 1_000;
const DEFAULT_MAX_REMOTE_TOOLS = 10_000;
const MAX_CONFIGURED_REMOTE_TOOLS = 100_000;
const MAX_REMOTE_TOOL_NAME_LENGTH = 128;
const MAX_REMOTE_TOOL_DESCRIPTION_LENGTH = 16_384;
const MAX_REMOTE_CURSOR_LENGTH = 4_096;
const MAX_REMOTE_METHOD_LENGTH = 256;

class RemoteMCPHttpError extends Error {
  constructor(status: number) {
    super(`Remote MCP request failed (${status})`);
    this.name = "RemoteMCPHttpError";
  }
}

class RemoteMCPOAuthExpiredHttpError extends RemoteMCPHttpError {
  constructor(status: number) {
    super(status);
    this.name = "RemoteMCPOAuthExpiredHttpError";
  }
}

/** Static value or request-scoped resolver accepted by remote MCP configuration. */
export type RemoteMCPResolvableValue<T> =
  | T
  | ((context?: ToolExecutionContext) => T | Promise<T>);

/** Configuration used by remote MCP tool source. */
export interface RemoteMCPToolSourceConfig {
  /** Stable source identifier used in JSON-RPC request IDs. */
  id?: string;
  /** Absolute HTTP or HTTPS MCP endpoint, or a request-scoped resolver. */
  endpoint: RemoteMCPResolvableValue<string>;
  /** Optional request headers or request-scoped header resolver. */
  headers?: RemoteMCPResolvableValue<HeadersInit | undefined>;
  /** Optional fetch implementation. Defaults to the active global fetch at request time. */
  fetch?: typeof fetch;
  /** JSON-RPC method used to list tools. */
  listMethod?: string;
  /** JSON-RPC method used to execute a tool. */
  callMethod?: string;
  /** Timeout applied to each outbound JSON-RPC request. */
  requestTimeoutMs?: number;
  /** Maximum bytes accepted in a successful JSON-RPC response. */
  maxResponseBytes?: number;
  /** Maximum bytes sent in one JSON-RPC request body. */
  maxRequestBytes?: number;
  /** Maximum pages accepted from one tools/list operation. */
  maxToolListPages?: number;
  /** Maximum tool definitions accepted from one tools/list operation. */
  maxTools?: number;
}

interface NormalizedRemoteMCPToolSourceConfig {
  readonly id: string;
  readonly endpoint: RemoteMCPResolvableValue<string>;
  readonly headers?: RemoteMCPResolvableValue<HeadersInit | undefined>;
  readonly fetch?: typeof fetch;
  readonly listMethod: string;
  readonly callMethod: string;
  readonly requestTimeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxRequestBytes: number;
  readonly maxToolListPages: number;
  readonly maxTools: number;
}

interface JsonRpcErrorObject {
  message?: unknown;
  data?: unknown;
}

interface JsonRpcCallToolContentItem {
  text?: unknown;
}

interface SseEvent {
  data: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidConfig(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail: `Remote MCP ${detail}` });
}

function normalizePositiveInteger(
  value: unknown,
  defaultValue: number,
  maximum: number,
  name: string,
): number {
  if (value === undefined) return defaultValue;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    invalidConfig(`${name} must be a positive safe integer no greater than ${maximum}`);
  }
  return value as number;
}

function hasUnsafeControlCharacters(value: string, allowFormattingWhitespace = false): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code === 0x7f ||
      (code < 0x20 &&
        !(allowFormattingWhitespace && (code === 0x09 || code === 0x0a || code === 0x0d)))
    ) {
      return true;
    }
  }
  return false;
}

function normalizeNonEmptyString(
  value: unknown,
  fallback: string,
  name: string,
  maximumLength: number,
): string {
  const resolved = value ?? fallback;
  if (
    typeof resolved !== "string" || resolved.trim().length === 0 ||
    resolved !== resolved.trim() || resolved.length > maximumLength ||
    hasUnsafeControlCharacters(resolved)
  ) {
    invalidConfig(`${name} must be a non-empty string within the supported length`);
  }
  return resolved;
}

function normalizeEndpoint(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalidConfig("endpoint must be a non-empty absolute URL");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    invalidConfig("endpoint must be a non-empty absolute URL");
  }
  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    invalidConfig("endpoint must use http or https");
  }
  if (endpoint.username || endpoint.password) {
    invalidConfig("endpoint must not contain URL credentials");
  }
  return endpoint.toString();
}

function normalizeRemoteMCPConfig(
  config: RemoteMCPToolSourceConfig,
): NormalizedRemoteMCPToolSourceConfig {
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    invalidConfig("configuration must be an object");
  }

  let prototype: object | null;
  let descriptors: PropertyDescriptorMap;
  try {
    prototype = Object.getPrototypeOf(config);
    descriptors = Object.getOwnPropertyDescriptors(config);
  } catch {
    invalidConfig("configuration could not be inspected");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    invalidConfig("configuration must be a plain object");
  }
  if (Object.values(descriptors).some((descriptor) => !("value" in descriptor))) {
    invalidConfig("configuration must use data properties");
  }
  const read = (property: keyof RemoteMCPToolSourceConfig): unknown => descriptors[property]?.value;

  const rawEndpoint = read("endpoint");
  const endpoint = typeof rawEndpoint === "function"
    ? rawEndpoint as RemoteMCPResolvableValue<string>
    : normalizeEndpoint(rawEndpoint);
  const fetchImpl = read("fetch");
  if (fetchImpl !== undefined && typeof fetchImpl !== "function") {
    invalidConfig("fetch must be a function");
  }
  let headers = read("headers") as RemoteMCPResolvableValue<HeadersInit | undefined> | undefined;
  if (headers !== undefined && typeof headers !== "function") {
    try {
      headers = new Headers(headers);
    } catch {
      invalidConfig("headers must be valid HTTP headers");
    }
  }

  return Object.freeze({
    id: normalizeNonEmptyString(read("id"), "remote-mcp", "id", MAX_REMOTE_TOOL_NAME_LENGTH),
    endpoint,
    ...(headers === undefined ? {} : { headers }),
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl as typeof fetch }),
    listMethod: normalizeNonEmptyString(
      read("listMethod"),
      "tools/list",
      "listMethod",
      MAX_REMOTE_METHOD_LENGTH,
    ),
    callMethod: normalizeNonEmptyString(
      read("callMethod"),
      "tools/call",
      "callMethod",
      MAX_REMOTE_METHOD_LENGTH,
    ),
    requestTimeoutMs: normalizePositiveInteger(
      read("requestTimeoutMs"),
      DEFAULT_REMOTE_MCP_REQUEST_TIMEOUT_MS,
      MAX_REMOTE_MCP_REQUEST_TIMEOUT_MS,
      "requestTimeoutMs",
    ),
    maxResponseBytes: normalizePositiveInteger(
      read("maxResponseBytes"),
      DEFAULT_REMOTE_MCP_MAX_RESPONSE_BYTES,
      MAX_REMOTE_MCP_BODY_BYTES,
      "maxResponseBytes",
    ),
    maxRequestBytes: normalizePositiveInteger(
      read("maxRequestBytes"),
      DEFAULT_REMOTE_MCP_MAX_REQUEST_BYTES,
      MAX_REMOTE_MCP_BODY_BYTES,
      "maxRequestBytes",
    ),
    maxToolListPages: normalizePositiveInteger(
      read("maxToolListPages"),
      DEFAULT_MAX_TOOL_LIST_PAGES,
      MAX_CONFIGURED_TOOL_LIST_PAGES,
      "maxToolListPages",
    ),
    maxTools: normalizePositiveInteger(
      read("maxTools"),
      DEFAULT_MAX_REMOTE_TOOLS,
      MAX_CONFIGURED_REMOTE_TOOLS,
      "maxTools",
    ),
  });
}

function resolveFetch(fetchImpl: typeof fetch | undefined): typeof fetch {
  const resolvedFetch = fetchImpl ?? globalThis.fetch;
  if (typeof resolvedFetch !== "function") {
    invalidConfig("fetch must be a function");
  }
  return resolvedFetch;
}

function isResolver<T>(
  value: RemoteMCPResolvableValue<T>,
): value is (context?: ToolExecutionContext) => T | Promise<T> {
  return typeof value === "function";
}

const TOOL_ANNOTATION_BOOLEAN_KEYS = [
  "readOnlyHint",
  "destructiveHint",
  "idempotentHint",
  "openWorldHint",
] as const satisfies readonly (keyof ToolAnnotations)[];

interface NormalizedRemoteToolAnnotations {
  readonly title?: string;
  readonly annotations?: ToolAnnotations;
}

function remoteProtocolError(detail: string): never {
  throw NETWORK_ERROR.create({ detail: `Remote MCP ${detail}` });
}

function normalizeToolTitle(
  value: unknown,
  toolName: string,
  location: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" || value.trim().length === 0 || value !== value.trim() ||
    value.length > MAX_REMOTE_TOOL_DESCRIPTION_LENGTH ||
    hasUnsafeControlCharacters(value, true)
  ) {
    remoteProtocolError(`tool ${toolName} had an invalid ${location}`);
  }
  return value;
}

function normalizeToolAnnotations(
  value: unknown,
  toolName: string,
): NormalizedRemoteToolAnnotations {
  if (!isRecord(value)) {
    remoteProtocolError(`tool ${toolName} had invalid annotations`);
  }

  const annotations: Record<string, boolean> = {};
  for (const key of TOOL_ANNOTATION_BOOLEAN_KEYS) {
    const entry = value[key];
    if (entry === undefined) continue;
    if (typeof entry !== "boolean") {
      remoteProtocolError(`tool ${toolName} had invalid annotations`);
    }
    annotations[key] = entry;
  }

  const title = normalizeToolTitle(value.title, toolName, "annotation title");
  return {
    ...(title === undefined ? {} : { title }),
    ...(Object.keys(annotations).length === 0
      ? {}
      : { annotations: annotations as ToolAnnotations }),
  };
}

function normalizeParameters(inputSchema: unknown, toolName: string): JsonSchema {
  if (inputSchema === undefined || inputSchema === null) {
    return { type: "object", properties: {} };
  }
  if (!isRecord(inputSchema)) {
    remoteProtocolError(`tool ${toolName} inputSchema must describe an object`);
  }
  if (Object.keys(inputSchema).length === 0) {
    return { type: "object", properties: {} };
  }
  if (inputSchema.type !== undefined && inputSchema.type !== "object") {
    remoteProtocolError(`tool ${toolName} inputSchema must describe an object`);
  }

  try {
    const snapshot = snapshotJsonValue(inputSchema, {
      label: `Remote MCP tool ${toolName} inputSchema`,
    });
    return {
      ...snapshot,
      type: "object",
    } as JsonSchema;
  } catch {
    remoteProtocolError(`tool ${toolName} inputSchema was not valid JSON data`);
  }
}

function normalizeToolDefinitions(result: Record<string, unknown>): ToolDefinition[] {
  const rawTools = result.tools;
  if (!Array.isArray(rawTools)) {
    remoteProtocolError("tools/list result did not include a tools array");
  }

  const definitions: ToolDefinition[] = [];
  for (let index = 0; index < rawTools.length; index += 1) {
    const entry = rawTools[index];
    if (!isRecord(entry)) {
      remoteProtocolError(`tools/list entry ${index} was not a JSON object`);
    }
    if (
      typeof entry.name !== "string" || entry.name.trim().length === 0 ||
      entry.name !== entry.name.trim() || entry.name.length > MAX_REMOTE_TOOL_NAME_LENGTH ||
      hasUnsafeControlCharacters(entry.name)
    ) {
      remoteProtocolError(`tools/list entry ${index} had an invalid name`);
    }
    const normalizedAnnotations = entry.annotations === undefined
      ? {}
      : normalizeToolAnnotations(entry.annotations, entry.name);
    const title = normalizeToolTitle(entry.title, entry.name, "title") ??
      normalizedAnnotations.title;

    let description = title ?? entry.name;
    if (entry.description !== undefined) {
      if (
        typeof entry.description !== "string" ||
        entry.description.length > MAX_REMOTE_TOOL_DESCRIPTION_LENGTH ||
        hasUnsafeControlCharacters(entry.description, true)
      ) {
        remoteProtocolError(`tool ${entry.name} had an invalid description`);
      }
      if (entry.description.trim().length > 0) {
        description = entry.description;
      }
    }

    const definition: ToolDefinition = {
      name: entry.name,
      description,
      parameters: normalizeParameters(entry.inputSchema, entry.name),
      ...(title === undefined ? {} : { title }),
    };

    if (normalizedAnnotations.annotations !== undefined) {
      definition.annotations = normalizedAnnotations.annotations;
    }

    definitions.push(definition);
  }

  return definitions;
}

function joinCallToolText(content: JsonRpcCallToolContentItem[]): string {
  return content
    .map((item) => (typeof item.text === "string" ? item.text : ""))
    .filter((item) => item.length > 0)
    .join("\n");
}

function parseJsonText(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isOauthExpiredMessage(value: unknown): boolean {
  // Check structured OAuth error field first (RFC 6749 / RFC 6750 error codes).
  if (typeof value === "object" && value !== null) {
    const errorCode = (value as Record<string, unknown>).error;
    if (
      errorCode === "invalid_grant" ||
      errorCode === "expired_token" ||
      errorCode === "token_revoked"
    ) {
      return true;
    }
  }
  // Fall back to substring scan for providers that embed the code in message text.
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  } catch {
    return false;
  }
  const normalized = text.toLowerCase();
  return (
    normalized.includes("invalid_grant") ||
    normalized.includes("expired_token") ||
    normalized.includes("token_revoked")
  );
}

function getIntegrationIdFromToolName(toolName: string): string {
  const separatorIndex = toolName.indexOf("__");
  const rawIntegration = separatorIndex > 0 ? toolName.slice(0, separatorIndex) : toolName;
  return rawIntegration || "integration";
}

function formatIntegrationName(integration: string): string {
  return integration
    .split(/[_-]+/)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ") || "Integration";
}

function buildOauthConnectUrl(
  endpoint: string,
  integration: string,
  context?: ToolExecutionContext,
): string {
  const encodedIntegration = encodeURIComponent(integration);
  const projectId = typeof context?.projectId === "string" && context.projectId.length > 0
    ? context.projectId
    : null;

  try {
    const url = new URL(`/oauth/connect/${encodedIntegration}`, endpoint);
    if (projectId) {
      url.searchParams.set("projectId", projectId);
    }
    return url.toString();
  } catch {
    return projectId
      ? `/oauth/connect/${encodedIntegration}?projectId=${encodeURIComponent(projectId)}`
      : `/oauth/connect/${encodedIntegration}`;
  }
}

function normalizeKnownToolError(
  value: unknown,
  toolName: string,
  endpoint: string,
  context?: ToolExecutionContext,
): unknown {
  if (!isOauthExpiredMessage(value)) {
    return value;
  }

  const integration = getIntegrationIdFromToolName(toolName);
  const label = formatIntegrationName(integration);
  return {
    error: "reconnect_required",
    code: "OAUTH_TOKEN_EXPIRED",
    integration,
    connectUrl: buildOauthConnectUrl(endpoint, integration, context),
    message: `${label} needs to be reconnected before this tool can run.`,
  };
}

function preserveToolExecutionErrorMarker(value: unknown): unknown {
  if (isRecord(value) && !Array.isArray(value)) {
    return hasToolExecutionErrorMarker(value) ? value : { ...value, isError: true };
  }

  return {
    isError: true,
    message: typeof value === "string" && value.trim().length > 0
      ? value
      : "Remote MCP tool returned an error",
    ...(value === undefined ? {} : { output: value }),
  };
}

function isReconnectRequiredToolOutput(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.error === "reconnect_required";
}

function getDataPropertyString(value: unknown, property: PropertyKey): string | undefined {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") {
    return undefined;
  }

  let current: object | null = value as object;
  for (let depth = 0; current !== null && depth < 32; depth += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(current, property);
    } catch {
      return undefined;
    }
    if (descriptor) {
      return "value" in descriptor && typeof descriptor.value === "string"
        ? descriptor.value
        : undefined;
    }
    try {
      current = Object.getPrototypeOf(current);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function normalizeKnownToolException(
  error: unknown,
  toolName: string,
  endpoint: string,
  context?: ToolExecutionContext,
): Record<string, unknown> | null {
  let isOauthExpiredHttpError = false;
  try {
    isOauthExpiredHttpError = error instanceof RemoteMCPOAuthExpiredHttpError;
  } catch {
    // Hostile thrown values must pass through without being inspected further.
  }
  const message = isOauthExpiredHttpError
    ? "invalid_grant"
    : typeof error === "string"
    ? error
    : getDataPropertyString(error, "message");
  if (message === undefined) return null;
  const normalized = normalizeKnownToolError(message, toolName, endpoint, context);
  return isReconnectRequiredToolOutput(normalized) ? normalized : null;
}

function extractJsonRpcErrorMessage(payload: Record<string, unknown>): string {
  const rawError = payload.error;
  if (!isRecord(rawError)) return "Remote MCP server returned an error";

  const errorObject = rawError as JsonRpcErrorObject;
  if (typeof errorObject.message === "string" && errorObject.message.length > 0) {
    return errorObject.message;
  }
  if (typeof errorObject.data === "string" && errorObject.data.length > 0) {
    return errorObject.data;
  }
  if (isRecord(errorObject.data) && typeof errorObject.data.detail === "string") {
    return errorObject.data.detail;
  }

  return "Remote MCP server returned an error";
}

function parseSseEvents(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  let currentEvent: SseEvent = { data: [] };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();

    if (line.length === 0) {
      if (currentEvent.data.length > 0) {
        events.push(currentEvent);
      }
      currentEvent = { data: [] };
      continue;
    }

    if (line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("data:")) {
      currentEvent.data.push(line.slice(5).trimStart());
    }
  }

  if (currentEvent.data.length > 0) {
    events.push(currentEvent);
  }

  return events;
}

function parseJsonRpcSsePayload(text: string): unknown {
  const parsedPayloads = parseSseEvents(text)
    .map((event) => parseJsonText(event.data.join("\n")))
    .filter((payload): payload is unknown => payload !== undefined);

  const jsonRpcPayload = parsedPayloads.find(
    (payload) => isRecord(payload) && ("result" in payload || "error" in payload),
  );

  if (jsonRpcPayload !== undefined) {
    return jsonRpcPayload;
  }

  if (parsedPayloads.length > 0) {
    return parsedPayloads[0];
  }

  throw NETWORK_ERROR.create({
    detail: "Remote MCP SSE response did not include a JSON-RPC payload",
  });
}

async function parseJsonRpcResponse(
  response: Response,
  maxResponseBytes: number,
): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const { text, truncated } = await readResponseTextPrefix(response, maxResponseBytes + 1);
  if (truncated) {
    throw NETWORK_ERROR.create({
      detail: `Remote MCP response exceeded ${maxResponseBytes} bytes`,
    });
  }

  if (contentType.includes("text/event-stream")) {
    return parseJsonRpcSsePayload(text);
  }

  const payload = parseJsonText(text);
  if (payload === undefined) {
    throw NETWORK_ERROR.create({
      detail: "Remote MCP response did not contain valid JSON",
    });
  }
  return payload;
}

async function resolveValue<T>(
  value: RemoteMCPResolvableValue<T>,
  context?: ToolExecutionContext,
): Promise<T> {
  const signal = context?.abortSignal;
  signal?.throwIfAborted();
  if (isResolver(value)) {
    const operation = Promise.resolve().then(() => value(context));
    return signal ? await raceWithAbort(operation, signal) : await operation;
  }
  return value;
}

async function resolveHeaders(
  headers: RemoteMCPResolvableValue<HeadersInit | undefined> | undefined,
  context?: ToolExecutionContext,
): Promise<Headers> {
  const resolvedHeaders = headers ? await resolveValue(headers, context) : undefined;
  let finalHeaders: Headers;
  try {
    finalHeaders = new Headers(resolvedHeaders);
  } catch {
    invalidConfig("headers resolver returned invalid HTTP headers");
  }
  finalHeaders.set("Content-Type", "application/json");
  finalHeaders.set("Accept", mergeAcceptHeader(finalHeaders.get("Accept")));
  return finalHeaders;
}

function mergeAcceptHeader(existingAccept: string | null): string {
  const requiredTypes = ["application/json", "text/event-stream"];
  const existingTypes = (existingAccept ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const existingKeys = new Set(
    existingTypes.map((entry) => entry.split(";")[0]?.trim().toLowerCase()).filter(Boolean),
  );

  for (const requiredType of requiredTypes) {
    if (!existingKeys.has(requiredType)) {
      existingTypes.push(requiredType);
    }
  }

  return existingTypes.join(", ");
}

interface RequestAbortScope {
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
  readonly dispose: () => void;
}

function toAbortReason(signal: AbortSignal): unknown {
  return signal.reason === undefined
    ? new DOMException("The operation was aborted", "AbortError")
    : signal.reason;
}

function createRequestAbortScope(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): RequestAbortScope {
  const controller = new AbortController();
  let didTimeOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const abortFromCaller = () => controller.abort(toAbortReason(callerSignal!));
  if (callerSignal?.aborted) {
    abortFromCaller();
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    timeoutId = setTimeout(() => {
      didTimeOut = true;
      controller.abort(new DOMException("Remote MCP request timed out", "TimeoutError"));
    }, timeoutMs);
  }

  return {
    signal: controller.signal,
    timedOut: () => didTimeOut,
    dispose: () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(toAbortReason(signal));

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(toAbortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function postJsonRpc(
  endpoint: string,
  headers: Headers,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
  callerSignal: AbortSignal | undefined,
  requestTimeoutMs: number,
  maxRequestBytes: number,
  maxResponseBytes: number,
): Promise<unknown> {
  let serializedBody: string;
  try {
    const bodySnapshot = snapshotJsonValue(body, {
      label: "Remote MCP request body",
      maxBytes: MAX_REMOTE_MCP_BODY_BYTES,
      maxStringLength: MAX_REMOTE_MCP_BODY_BYTES,
    });
    serializedBody = JSON.stringify(bodySnapshot);
  } catch (error) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: `Remote MCP request body was not JSON serializable: ${getErrorMessage(error)}`,
    });
  }
  if (new TextEncoder().encode(serializedBody).byteLength > maxRequestBytes) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: `Remote MCP request exceeded ${maxRequestBytes} bytes`,
    });
  }

  const abortScope = createRequestAbortScope(callerSignal, requestTimeoutMs);
  try {
    if (abortScope.signal.aborted) {
      throw toAbortReason(abortScope.signal);
    }
    const response = await raceWithAbort(
      fetchImpl(endpoint, {
        method: "POST",
        headers,
        body: serializedBody,
        redirect: "error",
        signal: abortScope.signal,
      }),
      abortScope.signal,
    );

    if (!response.ok) {
      const { text } = await raceWithAbort(
        readResponseTextPrefix(response, MAX_ERROR_BODY_BYTES),
        abortScope.signal,
      );
      const detail = text.slice(0, MAX_ERROR_BODY_LENGTH);
      if (isOauthExpiredMessage(detail)) {
        throw new RemoteMCPOAuthExpiredHttpError(response.status);
      }
      throw new RemoteMCPHttpError(response.status);
    }

    return await raceWithAbort(
      parseJsonRpcResponse(response, maxResponseBytes),
      abortScope.signal,
    );
  } catch (error) {
    if (abortScope.timedOut()) {
      throw TIMEOUT_ERROR.create({
        detail: `Remote MCP request timed out after ${requestTimeoutMs}ms`,
      });
    }
    if (callerSignal?.aborted) throw toAbortReason(callerSignal);
    throw error;
  } finally {
    abortScope.dispose();
  }
}

function getJsonRpcResult(payload: unknown, expectedId: string): unknown {
  if (!isRecord(payload)) {
    throw NETWORK_ERROR.create({ detail: "Remote MCP response was not a JSON object" });
  }
  if (payload.jsonrpc !== "2.0") {
    throw NETWORK_ERROR.create({ detail: "Remote MCP response used an invalid JSON-RPC version" });
  }
  if (payload.id !== expectedId) {
    throw NETWORK_ERROR.create({
      detail: "Remote MCP response id did not match the request",
    });
  }
  if ("error" in payload && "result" in payload) {
    throw NETWORK_ERROR.create({
      detail: "Remote MCP response included both result and error",
    });
  }

  if ("error" in payload) {
    throw NETWORK_ERROR.create({ detail: extractJsonRpcErrorMessage(payload) });
  }

  if (!("result" in payload)) {
    throw NETWORK_ERROR.create({ detail: "Remote MCP response did not include a result" });
  }

  return payload.result;
}

function normalizeCallToolResult(input: {
  result: unknown;
  toolName: string;
  endpoint: string;
  context?: ToolExecutionContext;
}): unknown {
  const result = input.result;
  if (!isRecord(result)) return result;

  // OAuth-expired detection must run only on ERROR channels. A successful
  // payload whose text merely mentions e.g. "invalid_grant" must pass through
  // untouched — otherwise a valid result is wholesale replaced with a
  // reconnect_required error.
  const isError = hasToolExecutionErrorMarker(result);
  const rawContent = result.content;

  if (Array.isArray(rawContent)) {
    const hasNonTextContent = rawContent.some((item) =>
      !isRecord(item) || typeof item.text !== "string"
    );
    const text = joinCallToolText(
      rawContent.filter((item): item is JsonRpcCallToolContentItem => isRecord(item)),
    );

    if (isError) {
      const errorBody = "structuredContent" in result
        ? result.structuredContent
        : hasNonTextContent
        ? {
          error: "tool_error",
          ...(text.length === 0 ? {} : { message: text }),
          content: rawContent,
        }
        : parseJsonText(text) ?? { error: "tool_error", message: text };
      return preserveToolExecutionErrorMarker(
        normalizeKnownToolError(errorBody, input.toolName, input.endpoint, input.context),
      );
    }

    if ("structuredContent" in result) {
      return result.structuredContent;
    }

    if (hasNonTextContent) return rawContent;

    return parseJsonText(text) ?? text;
  }

  if (isError) {
    const errorBody = "structuredContent" in result ? result.structuredContent : result;
    return preserveToolExecutionErrorMarker(
      normalizeKnownToolError(errorBody, input.toolName, input.endpoint, input.context),
    );
  }

  if ("structuredContent" in result) {
    return result.structuredContent;
  }

  return result;
}

function buildRunContextMeta(
  context: ToolExecutionContext | undefined,
): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = {};
  if (typeof context?.runId === "string" && context.runId.length > 0) {
    meta.run_id = context.runId;
  }
  if (typeof context?.agentId === "string" && context.agentId.length > 0) {
    meta.agent_id = context.agentId;
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}

/** Create remote MCP tool source. */
export function createRemoteMCPToolSource(
  config: RemoteMCPToolSourceConfig,
): RemoteToolSource {
  const normalizedConfig = normalizeRemoteMCPConfig(config);
  const { id, listMethod, callMethod } = normalizedConfig;

  return {
    id,
    async listTools(context) {
      const endpoint = normalizeEndpoint(
        await resolveValue(normalizedConfig.endpoint, context),
      );
      const headers = await resolveHeaders(normalizedConfig.headers, context);

      const definitions: ToolDefinition[] = [];
      const seenToolNames = new Set<string>();
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < normalizedConfig.maxToolListPages; page += 1) {
        const requestId = `${id}:tools:list`;
        const payload = await postJsonRpc(
          endpoint,
          headers,
          {
            jsonrpc: "2.0",
            id: requestId,
            method: listMethod,
            ...(cursor !== undefined ? { params: { cursor } } : {}),
          },
          resolveFetch(normalizedConfig.fetch),
          context?.abortSignal,
          normalizedConfig.requestTimeoutMs,
          normalizedConfig.maxRequestBytes,
          normalizedConfig.maxResponseBytes,
        );

        const result = getJsonRpcResult(payload, requestId);
        if (!isRecord(result)) {
          remoteProtocolError("tools/list result was not a JSON object");
        }
        const pageDefinitions = normalizeToolDefinitions(result);
        if (definitions.length + pageDefinitions.length > normalizedConfig.maxTools) {
          remoteProtocolError(`tools/list exceeded ${normalizedConfig.maxTools} tools`);
        }
        for (const definition of pageDefinitions) {
          if (seenToolNames.has(definition.name)) {
            remoteProtocolError(`tools/list repeated tool name ${definition.name}`);
          }
          seenToolNames.add(definition.name);
          definitions.push(definition);
        }

        const rawNextCursor = result.nextCursor;
        if (rawNextCursor === undefined || rawNextCursor === "") {
          return definitions;
        }
        if (
          typeof rawNextCursor !== "string" ||
          rawNextCursor.length > MAX_REMOTE_CURSOR_LENGTH ||
          hasUnsafeControlCharacters(rawNextCursor)
        ) {
          remoteProtocolError("tools/list returned an invalid pagination cursor");
        }
        if (seenCursors.has(rawNextCursor)) {
          remoteProtocolError("tools/list returned a repeated pagination cursor");
        }
        seenCursors.add(rawNextCursor);
        if (page === normalizedConfig.maxToolListPages - 1) {
          remoteProtocolError(
            `tools/list exceeded ${normalizedConfig.maxToolListPages} pages`,
          );
        }
        cursor = rawNextCursor;
      }

      throw new Error("Unreachable remote MCP pagination state");
    },

    async executeTool(toolName, args, context) {
      if (
        typeof toolName !== "string" || toolName.trim().length === 0 ||
        toolName !== toolName.trim() || toolName.length > MAX_REMOTE_TOOL_NAME_LENGTH ||
        hasUnsafeControlCharacters(toolName)
      ) {
        throw INPUT_VALIDATION_FAILED.create({
          detail: "Remote MCP tool name was invalid",
        });
      }
      if (!isRecord(args)) {
        throw INPUT_VALIDATION_FAILED.create({
          detail: "Remote MCP tool arguments must be an object",
        });
      }

      const endpoint = normalizeEndpoint(
        await resolveValue(normalizedConfig.endpoint, context),
      );
      const headers = await resolveHeaders(normalizedConfig.headers, context);
      const meta = buildRunContextMeta(context);
      const requestId = `${id}:tools:call:${toolName}`;

      try {
        const payload = await postJsonRpc(
          endpoint,
          headers,
          {
            jsonrpc: "2.0",
            id: requestId,
            method: callMethod,
            params: {
              name: toolName,
              arguments: args,
              ...(meta ? { _meta: meta } : {}),
            },
          },
          resolveFetch(normalizedConfig.fetch),
          context?.abortSignal,
          normalizedConfig.requestTimeoutMs,
          normalizedConfig.maxRequestBytes,
          normalizedConfig.maxResponseBytes,
        );

        return normalizeCallToolResult({
          result: getJsonRpcResult(payload, requestId),
          toolName,
          endpoint,
          context,
        });
      } catch (error) {
        context?.abortSignal?.throwIfAborted();
        const normalizedError = normalizeKnownToolException(error, toolName, endpoint, context);
        if (normalizedError) {
          return normalizedError;
        }

        throw error;
      }
    },
  };
}
