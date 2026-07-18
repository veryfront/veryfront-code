import { logger } from "#veryfront/utils";
import { NETWORK_ERROR, TIMEOUT_ERROR } from "#veryfront/errors";
import type { ToolAnnotations } from "#veryfront/mcp/types.ts";
import type { JsonSchema } from "./schema/json-schema.ts";
import { hasToolExecutionErrorMarker } from "./result.ts";
import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "./types.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";

/** Default timeout for a single outbound remote MCP request. */
const REMOTE_MCP_REQUEST_TIMEOUT_MS = 30_000;
/** Upper bound on characters inspected when classifying a remote HTTP failure. */
const MAX_ERROR_BODY_LENGTH = 2_000;
const MAX_ERROR_BODY_BYTES = MAX_ERROR_BODY_LENGTH * 4;
/** Defensive cap on tools/list pagination to avoid unbounded cursor loops. */
const MAX_TOOL_LIST_PAGES = 50;

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
  fetch?: typeof fetch;
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
  return typeof value === "object" && value !== null;
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

function normalizeParameters(inputSchema: unknown): JsonSchema {
  if (!isRecord(inputSchema) || Object.keys(inputSchema).length === 0) {
    return { type: "object", properties: {} };
  }

  return inputSchema as JsonSchema;
}

function normalizeToolDefinitions(result: unknown): ToolDefinition[] {
  if (!isRecord(result)) return [];
  const rawTools = result.tools;
  if (!Array.isArray(rawTools)) return [];

  const definitions: ToolDefinition[] = [];
  for (const entry of rawTools) {
    if (!isRecord(entry)) continue;
    if (typeof entry.name !== "string" || entry.name.length === 0) continue;
    if (typeof entry.description !== "string") continue;

    const definition: ToolDefinition = {
      name: entry.name,
      description: entry.description,
      parameters: normalizeParameters(entry.inputSchema),
    };

    if (typeof entry.title === "string" && entry.title.length > 0) {
      definition.title = entry.title;
    }
    if (isToolAnnotations(entry.annotations)) {
      definition.annotations = entry.annotations;
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
  const text = typeof value === "string" ? value : JSON.stringify(value);
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

async function parseJsonRpcResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";

  if (contentType.includes("text/event-stream")) {
    return parseJsonRpcSsePayload(await response.text());
  }

  return await response.json();
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

/**
 * Build the AbortSignal for a single outbound request: a fresh timeout, combined
 * with the caller's abort signal when one is available (and the runtime supports
 * `AbortSignal.any`). A hung remote server otherwise blocks the whole agent loop.
 */
function buildRequestSignal(abortSignal: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(REMOTE_MCP_REQUEST_TIMEOUT_MS);
  if (abortSignal && typeof AbortSignal.any === "function") {
    return AbortSignal.any([abortSignal, timeout]);
  }
  return timeout;
}

async function postJsonRpc(
  endpoint: string,
  headers: Headers,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
  signal: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw TIMEOUT_ERROR.create({
        detail: `Remote MCP request timed out after ${REMOTE_MCP_REQUEST_TIMEOUT_MS}ms`,
      });
    }
    throw error;
  }

  if (!response.ok) {
    const { text } = await readResponseTextPrefix(response, MAX_ERROR_BODY_BYTES);
    const detail = text.slice(0, MAX_ERROR_BODY_LENGTH);
    if (isOauthExpiredMessage(detail)) {
      throw new RemoteMCPOAuthExpiredHttpError(response.status);
    }
    throw new RemoteMCPHttpError(response.status);
  }

  return await parseJsonRpcResponse(response);
}

function getJsonRpcResult(payload: unknown): unknown {
  if (!isRecord(payload)) {
    throw NETWORK_ERROR.create({ detail: "Remote MCP response was not a JSON object" });
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
  const id = config.id ?? "remote-mcp";
  const listMethod = config.listMethod ?? "tools/list";
  const callMethod = config.callMethod ?? "tools/call";

  return {
    id,
    async listTools(context) {
      const endpoint = await resolveValue(config.endpoint, context);
      const headers = await resolveHeaders(config.headers, context);
      const fetchImpl = config.fetch ?? globalThis.fetch;

      const definitions: ToolDefinition[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_TOOL_LIST_PAGES; page += 1) {
        const payload = await postJsonRpc(
          endpoint,
          headers,
          {
            jsonrpc: "2.0",
            id: `${id}:tools:list`,
            method: listMethod,
            ...(cursor !== undefined ? { params: { cursor } } : {}),
          },
          fetchImpl,
          buildRequestSignal(context?.abortSignal),
        );

        const result = getJsonRpcResult(payload);
        definitions.push(...normalizeToolDefinitions(result));

        const nextCursor = isRecord(result) && typeof result.nextCursor === "string" &&
            result.nextCursor.length > 0
          ? result.nextCursor
          : undefined;
        if (nextCursor === undefined) {
          return definitions;
        }
        cursor = nextCursor;

        if (page === MAX_TOOL_LIST_PAGES - 1) {
          logger.warn("Remote MCP tools/list pagination capped", {
            pages: MAX_TOOL_LIST_PAGES,
          });
        }
      }

      return definitions;
    },

    async executeTool(toolName, args, context) {
      const endpoint = await resolveValue(config.endpoint, context);
      const headers = await resolveHeaders(config.headers, context);
      const meta = buildRunContextMeta(context);

      try {
        const payload = await postJsonRpc(
          endpoint,
          headers,
          {
            jsonrpc: "2.0",
            id: `${id}:tools:call:${toolName}`,
            method: callMethod,
            params: {
              name: toolName,
              arguments: args,
              ...(meta ? { _meta: meta } : {}),
            },
          },
          config.fetch ?? globalThis.fetch,
          buildRequestSignal(context?.abortSignal),
        );

        return normalizeCallToolResult({
          result: getJsonRpcResult(payload),
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
