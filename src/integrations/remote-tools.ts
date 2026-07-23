/**
 * Remote Integration Tools
 *
 * Fetches integration tool definitions from the API and executes tool calls
 * via the API's /integrations/tools/call endpoint.
 *
 * Design: NO global registration. Tools are fetched per-request because
 * different projects expose different authorized integration tools. The agent runtime
 * calls these functions at tool-enumeration and tool-execution time.
 */

import { logger } from "#veryfront/utils";
import { getApiBaseUrlEnv, getApiTokenEnv } from "#veryfront/config/env.ts";
import { getEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { isBoundedJsonValue } from "#veryfront/integrations/bounded-json.ts";
import { getActiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import {
  isIntegrationToolAllowedBySourcePolicy,
  parseIntegrationToolIdentity,
} from "#veryfront/integrations/source-policy.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";

/**
 * Default timeout for outbound integration API calls. Without it, a hung remote
 * server would block the whole agent loop indefinitely.
 */
const INTEGRATION_REQUEST_TIMEOUT_MS = 30_000;
const MAX_API_BASE_URL_LENGTH = 2_048;
const MAX_API_TOKEN_LENGTH = 16_384;
const MAX_REMOTE_TOOL_DEFINITIONS = 512;
const MAX_REMOTE_TOOL_DESCRIPTION_LENGTH = 16_384;
const MAX_REMOTE_JSON_DEPTH = 64;
const MAX_REMOTE_JSON_NODES = 10_000;
const MAX_REMOTE_JSON_KEY_LENGTH = 256;
const MAX_REMOTE_JSON_STRING_LENGTH = 65_536;
const MAX_TOOL_LIST_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_TOOL_CALL_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_TOOL_CALL_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_TOOL_CALL_CONTENT_ITEMS = 1_024;
const MAX_EXECUTION_ID_LENGTH = 256;
const MAX_SAFE_ERROR_VALUE_LENGTH = 256;
const REMOTE_TOOL_REQUEST_FAILED_MESSAGE = "Integration tool request failed";

type RemoteIntegrationFailureCode =
  | "invalid_config"
  | "invalid_arguments"
  | "invalid_response"
  | "request_failed"
  | "response_too_large";

class RemoteIntegrationFailure extends Error {
  constructor(readonly code: RemoteIntegrationFailureCode) {
    super(code);
    this.name = "RemoteIntegrationFailure";
  }
}

function containsAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RemoteToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface CallToolTextContent {
  text?: string;
}

/** Provider-facing definition discovered from the integration tools API. */
export interface RemoteIntegrationToolDefinition {
  /** Canonical integration-namespaced name exposed to the model. */
  name: string;
  /** Human-readable explanation of the tool behavior. */
  description: string;
  /** JSON Schema object describing the tool arguments. */
  parameters: Record<string, unknown>;
}

/** Request metadata forwarded when a remote integration tool executes. */
export interface RemoteIntegrationToolExecutionContext {
  /** Durable run identifier associated with the tool call. */
  runId?: string;
  /** Agent identifier associated with the tool call. */
  agentId?: string;
  /** Signal that cancels the outbound request when the caller stops the run. */
  abortSignal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Per-request token resolution
// ---------------------------------------------------------------------------

function isValidApiToken(token: unknown): token is string {
  return typeof token === "string" &&
    token.length > 0 &&
    token.length <= MAX_API_TOKEN_LENGTH &&
    token === token.trim() &&
    !containsAsciiControlCharacter(token);
}

/**
 * Resolve the API token for the active runtime mode.
 * Proxy mode requires a valid request-scoped project token. Single-project
 * runtimes may use their process-wide environment token.
 */
function resolveRequestToken(): string | undefined {
  const requestContext = getCurrentRequestContext();
  if (requestContext) {
    return isValidApiToken(requestContext.token) ? requestContext.token : undefined;
  }
  if (getEnvironmentConfig().proxyMode) return undefined;

  const environmentToken = getApiTokenEnv();
  return isValidApiToken(environmentToken) ? environmentToken : undefined;
}

// ---------------------------------------------------------------------------
// API communication
// ---------------------------------------------------------------------------

function joinCallToolText(content: CallToolTextContent[]): string {
  return content
    .map((item) => item.text)
    .filter((text): text is string => text !== undefined)
    .join("\n");
}

function parseJsonText(text: string): unknown | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRemoteJsonValueWithinBounds(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRemoteJsonValueWithinBounds(value: unknown): boolean {
  return isBoundedJsonValue(value, {
    maxDepth: MAX_REMOTE_JSON_DEPTH,
    maxNodes: MAX_REMOTE_JSON_NODES,
    maxKeyLength: MAX_REMOTE_JSON_KEY_LENGTH,
    maxStringLength: MAX_REMOTE_JSON_STRING_LENGTH,
  });
}

function parseToolListResponse(value: unknown): RemoteToolDefinition[] | undefined {
  try {
    if (!isRecord(value) || !Array.isArray(value.tools)) return undefined;
    if (value.tools.length > MAX_REMOTE_TOOL_DEFINITIONS) return undefined;

    const definitions: RemoteToolDefinition[] = [];
    const names = new Set<string>();
    for (const candidate of value.tools) {
      if (!isRecord(candidate)) return undefined;
      const name = candidate.name;
      const description = candidate.description;
      const inputSchema = candidate.inputSchema;
      if (
        typeof name !== "string" ||
        !isRemoteIntegrationTool(name) ||
        names.has(name) ||
        typeof description !== "string" ||
        description.length === 0 ||
        description.length > MAX_REMOTE_TOOL_DESCRIPTION_LENGTH ||
        !isRecord(inputSchema) ||
        !isRemoteJsonValueWithinBounds(inputSchema)
      ) {
        return undefined;
      }
      names.add(name);
      definitions.push({ name, description, inputSchema });
    }
    definitions.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    return definitions;
  } catch {
    return undefined;
  }
}

function resolveIntegrationApiUrl(baseUrl: string, path: string): string {
  if (
    typeof baseUrl !== "string" ||
    baseUrl.length === 0 ||
    baseUrl.length > MAX_API_BASE_URL_LENGTH ||
    baseUrl !== baseUrl.trim()
  ) {
    throw new RemoteIntegrationFailure("invalid_config");
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new RemoteIntegrationFailure("invalid_config");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new RemoteIntegrationFailure("invalid_config");
  }

  parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  return parsed.toString();
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The response body may already be locked or closed.
  }
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (/^\d+$/.test(declaredLength ?? "") && Number(declaredLength) > maxBytes) {
    await cancelResponseBody(response);
    throw new RemoteIntegrationFailure("response_too_large");
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new RemoteIntegrationFailure("response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function readBoundedResponseJson(response: Response, maxBytes: number): Promise<unknown> {
  const text = await readBoundedResponseText(response, maxBytes);
  try {
    const value: unknown = JSON.parse(text);
    if (!isRemoteJsonValueWithinBounds(value)) {
      throw new RemoteIntegrationFailure("invalid_response");
    }
    return value;
  } catch (error) {
    if (error instanceof RemoteIntegrationFailure) throw error;
    throw new RemoteIntegrationFailure("invalid_response");
  }
}

function stringifyBoundedRequest(value: unknown): string {
  try {
    const body = JSON.stringify(value);
    if (
      body === undefined ||
      new TextEncoder().encode(body).byteLength > MAX_TOOL_CALL_REQUEST_BYTES
    ) {
      throw new RemoteIntegrationFailure("invalid_arguments");
    }
    return body;
  } catch (error) {
    if (error instanceof RemoteIntegrationFailure) throw error;
    throw new RemoteIntegrationFailure("invalid_arguments");
  }
}

function createRequestSignal(externalSignal?: AbortSignal): {
  signal: AbortSignal;
  dispose(): void;
} {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) abortFromCaller();
  else externalSignal?.addEventListener("abort", abortFromCaller, { once: true });

  const timeout = setTimeout(
    () => controller.abort(new DOMException("Integration request timed out", "TimeoutError")),
    INTEGRATION_REQUEST_TIMEOUT_MS,
  );
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("Integration request aborted", "AbortError");
}

function normalizeExecutionId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_EXECUTION_ID_LENGTH ||
    value !== value.trim() ||
    containsAsciiControlCharacter(value)
  ) {
    throw new RemoteIntegrationFailure("invalid_arguments");
  }
  return value;
}

function isAbortSignal(value: unknown): value is AbortSignal {
  try {
    return typeof value === "object" &&
      value !== null &&
      typeof Reflect.get(value, "aborted") === "boolean" &&
      typeof Reflect.get(value, "addEventListener") === "function" &&
      typeof Reflect.get(value, "removeEventListener") === "function";
  } catch {
    return false;
  }
}

function prepareToolCall(
  toolName: string,
  args: Record<string, unknown>,
  context?: RemoteIntegrationToolExecutionContext,
): { body: string; abortSignal?: AbortSignal } {
  try {
    if (!isRecord(args) || (context !== undefined && !isRecord(context))) {
      throw new RemoteIntegrationFailure("invalid_arguments");
    }
    if (!isRemoteJsonValueWithinBounds(args)) {
      throw new RemoteIntegrationFailure("invalid_arguments");
    }
    const abortSignal = context?.abortSignal;
    if (abortSignal !== undefined && !isAbortSignal(abortSignal)) {
      throw new RemoteIntegrationFailure("invalid_arguments");
    }
    const body = stringifyBoundedRequest({
      name: toolName,
      arguments: args,
      run_id: normalizeExecutionId(context?.runId),
      agent_id: normalizeExecutionId(context?.agentId),
    });
    return { body, ...(abortSignal !== undefined ? { abortSignal } : {}) };
  } catch (error) {
    if (error instanceof RemoteIntegrationFailure) throw error;
    throw new RemoteIntegrationFailure("invalid_arguments");
  }
}

/**
 * Issue an authenticated POST to the integration tools API with a bounded
 * timeout. The two endpoints have different response contracts. tools/list
 * throws on failure while tools/call maps failures into a structured result,
 * so callers own response handling; this centralizes the auth headers and the
 * timeout AbortSignal that both share. No retry: tools/call is not idempotent
 * (a retried call could re-send an email or re-create a record).
 */
async function postIntegrationApi(
  baseUrl: string,
  path: string,
  token: string,
  signal: AbortSignal,
  body?: string,
): Promise<Response> {
  throwIfAborted(signal);
  return await fetch(resolveIntegrationApiUrl(baseUrl, path), {
    method: "POST",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body } : {}),
    signal,
  });
}

async function fetchToolList(
  baseUrl: string,
  token: string,
): Promise<RemoteToolDefinition[]> {
  const request = createRequestSignal();
  try {
    const response = await postIntegrationApi(
      baseUrl,
      "/integrations/tools/list",
      token,
      request.signal,
    );
    if (!response.ok) {
      await cancelResponseBody(response);
      throw new RemoteIntegrationFailure("request_failed");
    }

    const definitions = parseToolListResponse(
      await readBoundedResponseJson(response, MAX_TOOL_LIST_RESPONSE_BYTES),
    );
    if (!definitions) throw new RemoteIntegrationFailure("invalid_response");
    return definitions;
  } finally {
    request.dispose();
  }
}

async function callRemoteTool(
  baseUrl: string,
  token: string,
  body: string,
  context?: RemoteIntegrationToolExecutionContext,
): Promise<unknown> {
  const request = createRequestSignal(context?.abortSignal);
  try {
    const response = await postIntegrationApi(
      baseUrl,
      "/integrations/tools/call",
      token,
      request.signal,
      body,
    );
    if (!response.ok) {
      await cancelResponseBody(response);
      return {
        error: "api_error",
        status: response.status,
        message: REMOTE_TOOL_REQUEST_FAILED_MESSAGE,
      };
    }

    const result = await readBoundedResponseJson(response, MAX_TOOL_CALL_RESPONSE_BYTES);
    if (!isRecord(result)) return result;

    if (Object.hasOwn(result, "isError") && typeof result.isError !== "boolean") {
      throw new RemoteIntegrationFailure("invalid_response");
    }
    if (!Object.hasOwn(result, "content")) return result;
    if (!Array.isArray(result.content) || result.content.length > MAX_TOOL_CALL_CONTENT_ITEMS) {
      throw new RemoteIntegrationFailure("invalid_response");
    }
    if (Object.hasOwn(result, "structuredContent") && result.structuredContent !== undefined) {
      return result.structuredContent;
    }

    const content: CallToolTextContent[] = [];
    for (const item of result.content) {
      if (!isRecord(item) || (item.text !== undefined && typeof item.text !== "string")) {
        throw new RemoteIntegrationFailure("invalid_response");
      }
      content.push({ ...(item.text !== undefined ? { text: item.text } : {}) });
    }
    const text = joinCallToolText(content);

    if (result.isError === true) {
      const parsed = parseJsonText(text);
      if (isRecord(parsed)) return parsed;
      return { error: "tool_error", message: text };
    }
    return parseJsonText(text) ?? text;
  } finally {
    request.dispose();
  }
}

// ---------------------------------------------------------------------------
// Public API called by the agent runtime per request
// ---------------------------------------------------------------------------

/**
 * Fetch integration tool definitions for the current request context.
 * Returns ToolDefinition[] that the agent runtime merges into the model's
 * available tools. Returns empty array if no API config or no tools.
 *
 * Called per agent loop iteration. Results are scoped to the current
 * project's authorized integration tools via the per-request API token.
 */
export async function getRemoteIntegrationToolDefinitions(): Promise<
  RemoteIntegrationToolDefinition[]
> {
  const baseUrl = getApiBaseUrlEnv();
  const token = resolveRequestToken();
  if (!baseUrl || !token) return [];

  try {
    const remoteDefs = await fetchToolList(baseUrl, token);
    const sourceIntegrationPolicy = getActiveSourceIntegrationPolicy();
    return remoteDefs.filter((def) =>
      sourceIntegrationPolicy === undefined ||
      isIntegrationToolAllowedBySourcePolicy(def.name, sourceIntegrationPolicy)
    ).map((def) => ({
      name: def.name,
      description: def.description,
      parameters: def.inputSchema && Object.keys(def.inputSchema).length > 0
        ? def.inputSchema
        : { type: "object", properties: {} },
    }));
  } catch (err) {
    logger.error("Failed to fetch remote integration tool definitions", {
      reason: err instanceof RemoteIntegrationFailure ? err.code : "request_failed",
    });
    return [];
  }
}

/**
 * Check if a tool name looks like a remote integration tool.
 * Integration tools use "integration__tool_id" format (double underscore separator).
 */
export function isRemoteIntegrationTool(toolName: string): boolean {
  return parseIntegrationToolIdentity(toolName) !== null;
}

/**
 * Execute a remote integration tool via the API.
 * Called by the agent runtime when a tool isn't found in the local registry.
 */
export async function executeRemoteIntegrationTool(
  toolName: string,
  args: Record<string, unknown>,
  context?: RemoteIntegrationToolExecutionContext,
): Promise<unknown> {
  if (!isRemoteIntegrationTool(toolName)) {
    const safeToolName = typeof toolName === "string" &&
        toolName.length <= MAX_SAFE_ERROR_VALUE_LENGTH &&
        !containsAsciiControlCharacter(toolName)
      ? ` "${toolName}"`
      : "";
    throw new Error(
      `Remote integration tool${safeToolName} must use the canonical integration__tool_id name`,
    );
  }

  const sourceIntegrationPolicy = getActiveSourceIntegrationPolicy();
  if (
    sourceIntegrationPolicy !== undefined &&
    !isIntegrationToolAllowedBySourcePolicy(toolName, sourceIntegrationPolicy)
  ) {
    throw new Error(`Tool "${toolName}" is not allowed by the source integration policy`);
  }

  const baseUrl = getApiBaseUrlEnv();
  const token = resolveRequestToken();
  if (!baseUrl || !token) {
    return { error: "no_api_token", message: "No API token available" };
  }

  let prepared: { body: string; abortSignal?: AbortSignal };
  try {
    prepared = prepareToolCall(toolName, args, context);
  } catch {
    return {
      error: "invalid_arguments",
      message: "Remote integration tool arguments must be a bounded JSON object",
    };
  }

  try {
    return await callRemoteTool(
      baseUrl,
      token,
      prepared.body,
      prepared.abortSignal ? { abortSignal: prepared.abortSignal } : undefined,
    );
  } catch {
    if (prepared.abortSignal?.aborted) throwIfAborted(prepared.abortSignal);
    return { error: "api_error", message: REMOTE_TOOL_REQUEST_FAILED_MESSAGE };
  }
}
