import { NETWORK_ERROR, TIMEOUT_ERROR } from "#veryfront/errors";
import { getApiBaseUrlEnv } from "#veryfront/config/env.ts";
import type { ToolAnnotations } from "#veryfront/mcp/types.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import type { JsonSchema } from "./schema/json-schema.ts";
import { hasToolExecutionErrorMarker } from "./result.ts";
import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "./types.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import { guardedOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";

/** Default timeout for a single outbound remote MCP request. */
const REMOTE_MCP_REQUEST_TIMEOUT_MS = 30_000;
/** Maximum serialized JSON-RPC request admitted at the remote MCP boundary. */
const MAX_REMOTE_MCP_REQUEST_BYTES = 4 * 1024 * 1024;
/** Maximum successful tools/list response body. */
export const MAX_REMOTE_MCP_TOOL_LIST_RESPONSE_BYTES = 16 * 1024 * 1024;
/** Maximum successful tools/call response body. */
export const MAX_REMOTE_MCP_CALL_RESPONSE_BYTES = 4 * 1024 * 1024;
/** Upper bound on characters inspected when classifying a remote HTTP failure. */
const MAX_ERROR_BODY_LENGTH = 2_000;
const MAX_ERROR_BODY_BYTES = MAX_ERROR_BODY_LENGTH * 4;
/** Defensive cap on tools/list pagination to avoid unbounded cursor loops. */
export const MAX_REMOTE_MCP_TOOL_LIST_PAGES = 50;
/** Maximum number of remote definitions admitted atomically. */
export const MAX_REMOTE_MCP_TOOL_DEFINITIONS = 1_000;
const MAX_REMOTE_MCP_TOOL_NAME_BYTES = 128;
const MAX_REMOTE_MCP_TOOL_DESCRIPTION_BYTES = 1_024;
const MAX_REMOTE_MCP_TOOL_TITLE_BYTES = 1_024;
const MAX_REMOTE_MCP_TOOL_SCHEMA_BYTES = 16_384;
const MAX_REMOTE_MCP_TOOL_SCHEMA_DEPTH = 64;
const MAX_REMOTE_MCP_TOOL_SCHEMA_NODES = 4_096;
const MAX_REMOTE_MCP_CURSOR_LENGTH = 4_096;
const UTF8_ENCODER = new TextEncoder();

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

type ResolvableValue<T> = T | ((context?: ToolExecutionContext) => T | Promise<T>);

/** Configuration used by remote MCP tool source. */
export interface RemoteMCPToolSourceConfig {
  id?: string;
  endpoint: ResolvableValue<string>;
  headers?: ResolvableValue<HeadersInit | undefined>;
  listMethod?: string;
  callMethod?: string;
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

function isResolver<T>(
  value: ResolvableValue<T>,
): value is (context?: ToolExecutionContext) => T | Promise<T> {
  return typeof value === "function";
}

function isToolAnnotations(value: unknown): value is ToolAnnotations {
  if (!isRecord(value)) return false;

  for (const key of Object.keys(value)) {
    if (
      key !== "readOnlyHint" &&
      key !== "destructiveHint" &&
      key !== "idempotentHint" &&
      key !== "openWorldHint"
    ) {
      return false;
    }

    const entry = value[key];
    if (entry !== undefined && typeof entry !== "boolean") {
      return false;
    }
  }

  return true;
}

function protocolError(detail: string): Error {
  return NETWORK_ERROR.create({ detail });
}

function serializedByteLength(value: unknown): number {
  return UTF8_ENCODER.encode(JSON.stringify(value)).byteLength;
}

function isUtf8LengthWithin(value: string, maxBytes: number): boolean {
  return value.length <= maxBytes && UTF8_ENCODER.encode(value).byteLength <= maxBytes;
}

function isJsonStructureWithin(
  value: unknown,
  maxDepth: number,
  maxNodes: number,
): boolean {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    if (current.depth > maxDepth || ++nodes > maxNodes) return false;

    if (Array.isArray(current.value)) {
      for (const child of current.value) {
        stack.push({ value: child, depth: current.depth + 1 });
      }
      continue;
    }
    if (isRecord(current.value)) {
      for (const child of Object.values(current.value)) {
        stack.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
  return true;
}

function normalizeParameters(inputSchema: unknown, toolName: string): JsonSchema {
  const snapshot = snapshotBoundedJsonValue(inputSchema);
  if (
    !snapshot.success ||
    !isRecord(snapshot.value) ||
    !isJsonStructureWithin(
      snapshot.value,
      MAX_REMOTE_MCP_TOOL_SCHEMA_DEPTH,
      MAX_REMOTE_MCP_TOOL_SCHEMA_NODES,
    ) ||
    serializedByteLength(snapshot.value) > MAX_REMOTE_MCP_TOOL_SCHEMA_BYTES
  ) {
    throw protocolError(
      `Remote MCP tools/list returned a malformed input schema for tool "${toolName}"`,
    );
  }

  if (Object.keys(snapshot.value).length === 0) {
    return { type: "object", properties: {} };
  }

  return snapshot.value;
}

function normalizeToolDefinition(entry: unknown, index: number): ToolDefinition {
  if (!isRecord(entry)) {
    throw protocolError(
      `Remote MCP tools/list returned a malformed tool definition at index ${index}`,
    );
  }
  if (
    typeof entry.name !== "string" ||
    entry.name.length === 0 ||
    !isUtf8LengthWithin(entry.name, MAX_REMOTE_MCP_TOOL_NAME_BYTES) ||
    typeof entry.description !== "string" ||
    !isUtf8LengthWithin(entry.description, MAX_REMOTE_MCP_TOOL_DESCRIPTION_BYTES)
  ) {
    throw protocolError(
      `Remote MCP tools/list returned a malformed tool definition at index ${index}`,
    );
  }

  const definition: ToolDefinition = {
    name: entry.name,
    description: entry.description,
    parameters: normalizeParameters(entry.inputSchema, entry.name),
  };

  if (entry.title !== undefined) {
    if (
      typeof entry.title !== "string" ||
      entry.title.length === 0 ||
      !isUtf8LengthWithin(entry.title, MAX_REMOTE_MCP_TOOL_TITLE_BYTES)
    ) {
      throw protocolError(
        `Remote MCP tools/list returned a malformed title for tool "${entry.name}"`,
      );
    }
    definition.title = entry.title;
  }
  if (entry.annotations !== undefined) {
    const annotationsSnapshot = snapshotBoundedJsonValue(entry.annotations);
    if (
      !annotationsSnapshot.success ||
      !isToolAnnotations(annotationsSnapshot.value)
    ) {
      throw protocolError(
        `Remote MCP tools/list returned malformed annotations for tool "${entry.name}"`,
      );
    }
    definition.annotations = annotationsSnapshot.value;
  }

  return definition;
}

interface NormalizedToolListPage {
  definitions: ToolDefinition[];
  nextCursor: string | undefined;
}

function normalizeToolListPage(result: unknown): NormalizedToolListPage {
  if (!isRecord(result)) {
    throw protocolError("Remote MCP tools/list result was not a JSON object");
  }
  const rawTools = result.tools;
  if (!Array.isArray(rawTools)) {
    throw protocolError("Remote MCP tools/list result did not include a tools array");
  }
  if (rawTools.length > MAX_REMOTE_MCP_TOOL_DEFINITIONS) {
    throw protocolError(
      `Remote MCP tools/list cannot contain more than ${MAX_REMOTE_MCP_TOOL_DEFINITIONS} tools`,
    );
  }

  const definitions = rawTools.map(normalizeToolDefinition);
  const rawNextCursor = result.nextCursor;
  let nextCursor: string | undefined;
  if (rawNextCursor !== undefined && rawNextCursor !== null) {
    if (
      typeof rawNextCursor !== "string" ||
      rawNextCursor.length === 0 ||
      rawNextCursor.length > MAX_REMOTE_MCP_CURSOR_LENGTH
    ) {
      throw protocolError("Remote MCP tools/list returned an invalid pagination cursor");
    }
    nextCursor = rawNextCursor;
  }

  return { definitions, nextCursor };
}

function joinCallToolText(content: JsonRpcCallToolContentItem[]): string {
  return content
    .map((item) => (typeof item.text === "string" ? item.text : ""))
    .filter((item) => item.length > 0)
    .join("\n");
}

function parseJsonValue(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parseJsonText(text: string): unknown | undefined {
  const value = parseJsonValue(text);
  if (value === undefined) return undefined;
  const snapshot = snapshotBoundedJsonValue(value);
  return snapshot.success ? snapshot.value : undefined;
}

function isOauthExpiredMessage(value: unknown): boolean {
  const snapshot = snapshotBoundedJsonValue(value);
  const safeValue = snapshot.success ? snapshot.value : undefined;

  // Check structured OAuth error field first (RFC 6749 / RFC 6750 error codes).
  if (isRecord(safeValue)) {
    const errorCode = safeValue.error;
    if (
      errorCode === "invalid_grant" ||
      errorCode === "expired_token" ||
      errorCode === "token_revoked"
    ) {
      return true;
    }
  }
  // Fall back to substring scan for providers that embed the code in message text.
  let text = "";
  if (typeof value === "string") {
    text = value;
  } else if (snapshot.success) {
    text = JSON.stringify(snapshot.value);
  } else if (value instanceof Error) {
    text = value.message;
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

function normalizeKnownToolException(
  error: unknown,
  toolName: string,
  endpoint: string,
  context?: ToolExecutionContext,
): Record<string, unknown> | null {
  const message = error instanceof RemoteMCPOAuthExpiredHttpError
    ? "invalid_grant"
    : error instanceof Error
    ? error.message
    : String(error);
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

function parseJsonRpcSsePayload(text: string, expectedId: string): unknown {
  const parsedPayloads = parseSseEvents(text)
    // The response reader has already applied the method-specific byte cap.
    // tools/list deliberately permits a larger payload than the generic JSON
    // snapshot limit; its page and per-tool normalizers enforce finer bounds.
    .map((event) => parseJsonValue(event.data.join("\n")))
    .filter((payload): payload is unknown => payload !== undefined);

  const matchingPayload = parsedPayloads.find(
    (payload) =>
      isRecord(payload) &&
      payload.id === expectedId &&
      ("result" in payload || "error" in payload),
  );
  if (matchingPayload !== undefined) {
    return matchingPayload;
  }

  const unrelatedPayload = parsedPayloads.find(
    (payload) => isRecord(payload) && ("result" in payload || "error" in payload),
  );

  if (unrelatedPayload !== undefined) {
    return unrelatedPayload;
  }

  if (parsedPayloads.length > 0) {
    return parsedPayloads[0];
  }

  throw NETWORK_ERROR.create({
    detail: "Remote MCP SSE response did not include a JSON-RPC payload",
  });
}

function discardResponseBody(response: Response): void {
  if (!response.body) return;
  try {
    const cancellation = response.body.cancel();
    void cancellation.catch(() => {});
  } catch {
    // Response-body cleanup is best effort.
  }
}

function parseDeclaredContentLength(response: Response): number | undefined {
  const rawLength = response.headers.get("content-length");
  if (rawLength === null || !/^\d+$/.test(rawLength)) return undefined;
  const parsedLength = Number(rawLength);
  return Number.isSafeInteger(parsedLength) ? parsedLength : undefined;
}

async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const declaredLength = parseDeclaredContentLength(response);
  if (declaredLength !== undefined && declaredLength > maxBytes) {
    discardResponseBody(response);
    throw protocolError(
      `Remote MCP response exceeds the ${maxBytes}-byte response limit`,
    );
  }

  const { text, truncated } = await readResponseTextPrefix(
    response,
    maxBytes + 1,
    signal,
    { fatalUtf8: true },
  );
  if (truncated || UTF8_ENCODER.encode(text).byteLength > maxBytes) {
    throw protocolError(
      `Remote MCP response exceeds the ${maxBytes}-byte response limit`,
    );
  }
  return text;
}

async function parseJsonRpcResponse(
  response: Response,
  expectedId: string,
  maxBytes: number,
  signal: AbortSignal,
): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const text = await readBoundedResponseText(response, maxBytes, signal);

  if (contentType.includes("text/event-stream")) {
    return parseJsonRpcSsePayload(text, expectedId);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw protocolError("Remote MCP response body was not valid JSON");
  }
}

async function resolveValue<T>(
  value: ResolvableValue<T>,
  context?: ToolExecutionContext,
): Promise<T> {
  if (isResolver(value)) {
    return await value(context);
  }
  return value;
}

async function resolveHeaders(
  headers: ResolvableValue<HeadersInit | undefined> | undefined,
  context?: ToolExecutionContext,
): Promise<Headers> {
  const resolvedHeaders = headers ? await resolveValue(headers, context) : undefined;
  const finalHeaders = new Headers(resolvedHeaders);
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

interface RemoteMcpRequestSignalScope {
  signal: AbortSignal;
  didTimeout(): boolean;
  dispose(): void;
}

function createRequestSignalScope(
  callerSignal: AbortSignal | undefined,
): RemoteMcpRequestSignalScope {
  const controller = new AbortController();
  const forwardCallerAbort = () => controller.abort(callerSignal?.reason);
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort(
      new DOMException(
        `Remote MCP request timed out after ${REMOTE_MCP_REQUEST_TIMEOUT_MS}ms`,
        "TimeoutError",
      ),
    );
  }, REMOTE_MCP_REQUEST_TIMEOUT_MS);

  if (callerSignal) {
    callerSignal.addEventListener("abort", forwardCallerAbort, { once: true });
    if (callerSignal.aborted) forwardCallerAbort();
  }

  let disposed = false;
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener("abort", forwardCallerAbort);
    },
  };
}

function serializeJsonRpcRequest(body: Record<string, unknown>): string {
  const snapshot = snapshotBoundedJsonValue(body);
  if (!snapshot.success || !isRecord(snapshot.value)) {
    throw new TypeError("Remote MCP JSON-RPC request must be a bounded JSON object");
  }

  const serialized = JSON.stringify(snapshot.value);
  if (UTF8_ENCODER.encode(serialized).byteLength > MAX_REMOTE_MCP_REQUEST_BYTES) {
    throw new TypeError(
      `Remote MCP JSON-RPC request exceeds the ${MAX_REMOTE_MCP_REQUEST_BYTES}-byte request limit`,
    );
  }
  return serialized;
}

function validateEndpoint(endpoint: unknown): string {
  if (typeof endpoint !== "string" || endpoint.trim().length === 0) {
    throw new TypeError("Remote MCP endpoint must be a non-empty absolute HTTP(S) URL");
  }

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch (cause) {
    throw new TypeError("Remote MCP endpoint must be a non-empty absolute HTTP(S) URL", {
      cause,
    });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Remote MCP endpoint must use http: or https:");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new TypeError("Remote MCP endpoint must not include credentials");
  }
  return url.toString();
}

async function postJsonRpc(
  endpoint: string,
  headers: Headers,
  body: Record<string, unknown>,
  requestFetch: typeof fetch,
  callerSignal: AbortSignal | undefined,
  maxResponseBytes: number,
): Promise<unknown> {
  const expectedId = body.id;
  if (typeof expectedId !== "string" || expectedId.length === 0) {
    throw new TypeError("Remote MCP JSON-RPC request id must be a non-empty string");
  }
  const serializedBody = serializeJsonRpcRequest(body);
  const requestScope = createRequestSignalScope(callerSignal);

  try {
    const response = await requestFetch(endpoint, {
      method: "POST",
      headers,
      body: serializedBody,
      signal: requestScope.signal,
      redirect: "error",
    });

    if (!response.ok) {
      const { text } = await readResponseTextPrefix(
        response,
        MAX_ERROR_BODY_BYTES,
        requestScope.signal,
        { fatalUtf8: true },
      );
      const detail = text.slice(0, MAX_ERROR_BODY_LENGTH);
      if (isOauthExpiredMessage(detail)) {
        throw new RemoteMCPOAuthExpiredHttpError(response.status);
      }
      throw new RemoteMCPHttpError(response.status);
    }

    return await parseJsonRpcResponse(
      response,
      expectedId,
      maxResponseBytes,
      requestScope.signal,
    );
  } catch (error) {
    if (requestScope.signal.aborted) {
      if (requestScope.didTimeout()) {
        throw TIMEOUT_ERROR.create({
          detail: `Remote MCP request timed out after ${REMOTE_MCP_REQUEST_TIMEOUT_MS}ms`,
        });
      }
      throw NETWORK_ERROR.create({
        detail: "Remote MCP request was aborted",
      });
    }
    throw error;
  } finally {
    requestScope.dispose();
  }
}

function getJsonRpcResult(payload: unknown, expectedId: string): unknown {
  if (!isRecord(payload)) {
    throw NETWORK_ERROR.create({ detail: "Remote MCP response was not a JSON object" });
  }

  if (payload.jsonrpc !== "2.0") {
    throw protocolError('Remote MCP response must declare jsonrpc "2.0"');
  }
  if (payload.id !== expectedId) {
    throw protocolError(
      `Remote MCP response id did not match request id "${expectedId}"`,
    );
  }

  const hasError = Object.hasOwn(payload, "error");
  const hasResult = Object.hasOwn(payload, "result");
  if (hasError && hasResult) {
    throw protocolError("Remote MCP response cannot include both result and error");
  }
  if (hasError) {
    throw NETWORK_ERROR.create({ detail: extractJsonRpcErrorMessage(payload) });
  }

  if (!hasResult) {
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
    const text = joinCallToolText(
      rawContent.filter((item): item is JsonRpcCallToolContentItem => isRecord(item)),
    );

    if (isError) {
      const errorBody = "structuredContent" in result
        ? result.structuredContent
        : parseJsonText(text) ?? { error: "tool_error", message: text };
      return preserveToolExecutionErrorMarker(
        normalizeKnownToolError(errorBody, input.toolName, input.endpoint, input.context),
      );
    }

    if ("structuredContent" in result) {
      return result.structuredContent;
    }

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

/**
 * True when `endpoint` targets the Veryfront control plane, whose MCP handler
 * reads `_meta.run_id` back into the integration authorization gate. Every
 * other server treats it as opaque correlation metadata.
 */
function endpointBindsToolAuthorization(endpoint: string): boolean {
  const apiBaseUrl = getApiBaseUrlEnv();
  if (typeof apiBaseUrl !== "string" || apiBaseUrl.length === 0) return false;
  const endpointUrl = parseMcpRequestEndpoint(endpoint);
  if (!endpointUrl) return false;

  try {
    const apiBase = new URL(apiBaseUrl);
    if (endpointUrl.origin !== apiBase.origin) return false;

    const basePath = apiBase.pathname.replace(/\/+$/, "");
    const controlPlanePath = `${basePath}/mcp`;
    if (endpointUrl.pathname === controlPlanePath) return true;

    const projectPathPrefix = `${basePath}/projects/`;
    if (!endpointUrl.pathname.startsWith(projectPathPrefix)) return false;
    const projectScopedPath = endpointUrl.pathname.slice(projectPathPrefix.length);
    return /^[^/]+\/mcp\/?$/.test(projectScopedPath);
  } catch {
    return false;
  }
}

function buildRunContextMeta(
  context: ToolExecutionContext | undefined,
  endpoint: string,
): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = {};
  // Suppress only where the run id would be read as an authorization binding.
  // Third-party servers keep receiving it as correlation metadata.
  const suppressRunId = context?.runIdBindsToolAuthorization === false &&
    endpointBindsToolAuthorization(endpoint);
  if (
    !suppressRunId &&
    typeof context?.runId === "string" && context.runId.length > 0
  ) {
    meta.run_id = context.runId;
  }
  if (typeof context?.agentId === "string" && context.agentId.length > 0) {
    meta.agent_id = context.agentId;
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}

function createRemoteMCPToolSourceWithFetch(
  config: RemoteMCPToolSourceConfig,
  getRequestFetch: (endpoint: string) => typeof fetch,
): RemoteToolSource {
  const id = config.id ?? "remote-mcp";
  const listMethod = config.listMethod ?? "tools/list";
  const callMethod = config.callMethod ?? "tools/call";

  return {
    id,
    async listTools(context) {
      const endpoint = validateEndpoint(await resolveValue(config.endpoint, context));
      const headers = await resolveHeaders(config.headers, context);

      const definitions: ToolDefinition[] = [];
      const definitionNames = new Set<string>();
      const seenCursors = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < MAX_REMOTE_MCP_TOOL_LIST_PAGES; page += 1) {
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
          getRequestFetch(endpoint),
          context?.abortSignal,
          MAX_REMOTE_MCP_TOOL_LIST_RESPONSE_BYTES,
        );

        const result = getJsonRpcResult(payload, requestId);
        const { definitions: pageDefinitions, nextCursor } = normalizeToolListPage(result);
        if (
          definitions.length + pageDefinitions.length >
            MAX_REMOTE_MCP_TOOL_DEFINITIONS
        ) {
          throw protocolError(
            `Remote MCP tools/list cannot contain more than ${MAX_REMOTE_MCP_TOOL_DEFINITIONS} tools`,
          );
        }
        for (const definition of pageDefinitions) {
          if (definitionNames.has(definition.name)) {
            throw protocolError(
              `Remote MCP tools/list returned duplicate tool name "${definition.name}"`,
            );
          }
          definitionNames.add(definition.name);
          definitions.push(definition);
        }

        if (nextCursor === undefined) {
          return definitions;
        }
        if (seenCursors.has(nextCursor)) {
          throw protocolError(
            `Remote MCP tools/list returned repeated pagination cursor "${nextCursor}"`,
          );
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;

        if (page === MAX_REMOTE_MCP_TOOL_LIST_PAGES - 1) {
          throw protocolError(
            `Remote MCP tools/list exceeded ${MAX_REMOTE_MCP_TOOL_LIST_PAGES} pages`,
          );
        }
      }

      throw protocolError(
        `Remote MCP tools/list exceeded ${MAX_REMOTE_MCP_TOOL_LIST_PAGES} pages`,
      );
    },

    async executeTool(toolName, args, context) {
      const endpoint = validateEndpoint(await resolveValue(config.endpoint, context));
      const headers = await resolveHeaders(config.headers, context);
      const meta = buildRunContextMeta(context, endpoint);
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
          getRequestFetch(endpoint),
          context?.abortSignal,
          MAX_REMOTE_MCP_CALL_RESPONSE_BYTES,
        );

        const result = getJsonRpcResult(payload, requestId);
        const resultSnapshot = snapshotBoundedJsonValue(result);
        if (!resultSnapshot.success) {
          throw protocolError("Remote MCP tools/call returned an unbounded JSON result");
        }
        return normalizeCallToolResult({
          result: resultSnapshot.value,
          toolName,
          endpoint,
          context,
        });
      } catch (error) {
        const normalizedError = normalizeKnownToolException(error, toolName, endpoint, context);
        if (normalizedError) {
          return normalizedError;
        }

        throw error;
      }
    },
  };
}

/** Create a remote MCP source with the framework's guarded outbound transport. */
export function createRemoteMCPToolSource(
  config: RemoteMCPToolSourceConfig,
): RemoteToolSource {
  return createRemoteMCPToolSourceWithFetch(config, () => guardedOutboundFetch);
}

/** Deployment-owned transport policy for trusted MCP endpoint roots. */
export interface RemoteMCPToolSourceTransportOptions {
  /** Complete endpoint URLs allowed to use {@link requestFetch}. */
  trustedEndpoints: readonly string[];
  /** Host transport captured by the trusted deployment at startup. */
  requestFetch: typeof fetch;
}

function normalizeTrustedEndpoint(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password || url.search || url.hash) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/** Parse a safe MCP request URL while preserving its query string. */
function parseMcpRequestEndpoint(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.username || url.password || url.hash) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function normalizeMcpRequestEndpoint(value: string): string | undefined {
  const url = parseMcpRequestEndpoint(value);
  if (!url) return undefined;
  url.search = "";
  return url.toString();
}

/**
 * Create a remote MCP source factory with narrowly scoped host transport.
 *
 * Exact trusted endpoints and their project-scoped MCP routes use the supplied
 * transport. All other resolved endpoints retain the guarded outbound path.
 */
export function createRemoteMCPToolSourceFactoryWithTransport(
  options: RemoteMCPToolSourceTransportOptions,
): (config: RemoteMCPToolSourceConfig) => RemoteToolSource {
  const trustedEndpoints = new Set<string>();
  for (const value of options.trustedEndpoints) {
    const endpoint = normalizeTrustedEndpoint(value);
    if (!endpoint) {
      throw new TypeError("Invalid trusted endpoint");
    }
    trustedEndpoints.add(endpoint);
  }

  return (config) =>
    createRemoteMCPToolSourceWithFetch(
      config,
      (endpoint) =>
        isTrustedDeploymentMcpEndpoint(endpoint, trustedEndpoints)
          ? options.requestFetch
          : guardedOutboundFetch,
    );
}

function isTrustedDeploymentMcpEndpoint(
  endpoint: string,
  trustedEndpoints: ReadonlySet<string>,
): boolean {
  const normalizedEndpoint = normalizeMcpRequestEndpoint(endpoint);
  if (!normalizedEndpoint) return false;
  if (trustedEndpoints.has(normalizedEndpoint)) return true;

  let endpointUrl: URL;
  try {
    endpointUrl = new URL(normalizedEndpoint);
  } catch {
    return false;
  }

  for (const trustedEndpoint of trustedEndpoints) {
    const trustedUrl = new URL(trustedEndpoint);
    if (endpointUrl.origin !== trustedUrl.origin) continue;

    const trustedPath = trustedUrl.pathname.replace(/\/+$/, "");
    if (!trustedPath.endsWith("/mcp")) continue;
    const projectPathPrefix = `${trustedPath.slice(0, -4)}/projects/`;
    if (!endpointUrl.pathname.startsWith(projectPathPrefix)) continue;
    const projectScopedPath = endpointUrl.pathname.slice(projectPathPrefix.length);
    if (/^[^/]+\/mcp\/?$/.test(projectScopedPath)) return true;
  }

  return false;
}
