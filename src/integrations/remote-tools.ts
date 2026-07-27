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

import { getApiBaseUrlEnv, getApiTokenEnv } from "#veryfront/config/env.ts";
import { getEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { getActiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import {
  isIntegrationToolAllowedBySourcePolicy,
  parseIntegrationToolIdentity,
} from "#veryfront/integrations/source-policy.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { type BoundedJsonValue, snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { logger } from "#veryfront/utils";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";

import type { ToolDefinition, ToolExecutionContext } from "#veryfront/tool";
import {
  INTEGRATION_REQUEST_TIMEOUT_MS,
  MAX_INTEGRATION_API_ERROR_RESPONSE_BYTES,
  MAX_INTEGRATION_CALL_REQUEST_BYTES,
  MAX_INTEGRATION_TOOL_CALL_RESPONSE_BYTES,
  MAX_INTEGRATION_TOOL_LIST_RESPONSE_BYTES,
  MAX_REMOTE_INTEGRATION_CONTEXT_ID_LENGTH,
  MAX_REMOTE_INTEGRATION_TOOL_DEFINITIONS,
  MAX_REMOTE_INTEGRATION_TOOL_DESCRIPTION_LENGTH,
  MAX_REMOTE_INTEGRATION_TOOL_NAME_LENGTH,
  MAX_REMOTE_INTEGRATION_TOOL_SCHEMA_BYTES,
  MAX_REMOTE_INTEGRATION_TOOL_SCHEMA_DEPTH,
} from "./limits.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RemoteToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface IntegrationRequestSignalScope {
  signal: AbortSignal;
  dispose: () => void;
}

const utf8Encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Per-request token resolution
// ---------------------------------------------------------------------------

function isValidApiToken(token: unknown): token is string {
  return typeof token === "string" && token.length > 0 && token === token.trim();
}

/**
 * Resolve the API token for the active runtime mode.
 * Proxy mode requires a valid request-scoped project token. Single-project
 * runtimes may use their process-wide environment token.
 */
function hasExplicitRequestCredential(
  context: ToolExecutionContext | undefined,
): context is ToolExecutionContext & { authToken: unknown } {
  return context !== undefined && Object.hasOwn(context, "authToken");
}

function resolveRequestToken(context?: ToolExecutionContext): string | undefined {
  if (hasExplicitRequestCredential(context)) {
    return isValidApiToken(context.authToken) ? context.authToken : undefined;
  }

  const requestContext = getCurrentRequestContext();
  if (requestContext) {
    return isValidApiToken(requestContext.token) ? requestContext.token : undefined;
  }
  if (getEnvironmentConfig().proxyMode) return undefined;

  const environmentToken = getApiTokenEnv();
  return isValidApiToken(environmentToken) ? environmentToken : undefined;
}

function normalizeProjectSlug(projectSlug: string | undefined): string | undefined {
  const normalized = projectSlug?.trim();
  return normalized || undefined;
}

function resolveRequestProjectSlug(context?: ToolExecutionContext): string | undefined {
  if (hasExplicitRequestCredential(context)) {
    return normalizeProjectSlug(context.projectSlug);
  }

  const requestContext = getCurrentRequestContext();
  if (requestContext) {
    return normalizeProjectSlug(requestContext.projectSlug);
  }
  return normalizeProjectSlug(getEnvironmentConfig().projectSlug);
}

// ---------------------------------------------------------------------------
// API communication
// ---------------------------------------------------------------------------

function joinCallToolText(content: unknown[]): string {
  return content
    .map((item): string | undefined =>
      isRecord(item) && typeof item.text === "string" ? item.text : undefined
    )
    .filter((text): text is string => text !== undefined)
    .join("\n");
}

function parseJsonText(text: string): unknown | undefined {
  try {
    const snapshot = snapshotBoundedJsonValue(JSON.parse(text));
    return snapshot.success ? snapshot.value : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonDepthWithin(value: BoundedJsonValue, maxDepth: number): boolean {
  const stack: Array<{ value: BoundedJsonValue; depth: number }> = [{ value, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    if (current.depth > maxDepth) return false;
    if (Array.isArray(current.value)) {
      for (const child of current.value) {
        stack.push({ value: child, depth: current.depth + 1 });
      }
      continue;
    }
    if (isRecord(current.value)) {
      for (const child of Object.values(current.value)) {
        stack.push({ value: child as BoundedJsonValue, depth: current.depth + 1 });
      }
    }
  }
  return true;
}

function parseRemoteToolDefinition(value: unknown): RemoteToolDefinition | undefined {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    value.name.length > MAX_REMOTE_INTEGRATION_TOOL_NAME_LENGTH ||
    !isRemoteIntegrationTool(value.name) ||
    typeof value.description !== "string" ||
    value.description.length > MAX_REMOTE_INTEGRATION_TOOL_DESCRIPTION_LENGTH
  ) {
    return undefined;
  }

  const schemaSnapshot = snapshotBoundedJsonValue(value.inputSchema);
  if (
    !schemaSnapshot.success ||
    !isRecord(schemaSnapshot.value) ||
    !isJsonDepthWithin(schemaSnapshot.value, MAX_REMOTE_INTEGRATION_TOOL_SCHEMA_DEPTH)
  ) {
    return undefined;
  }

  const serializedSchema = JSON.stringify(schemaSnapshot.value);
  if (utf8Encoder.encode(serializedSchema).byteLength > MAX_REMOTE_INTEGRATION_TOOL_SCHEMA_BYTES) {
    return undefined;
  }

  return {
    name: value.name,
    description: value.description,
    inputSchema: schemaSnapshot.value,
  };
}

function parseToolListResponse(value: unknown): RemoteToolDefinition[] | undefined {
  if (
    !isRecord(value) ||
    !Array.isArray(value.tools) ||
    value.tools.length > MAX_REMOTE_INTEGRATION_TOOL_DEFINITIONS
  ) {
    return undefined;
  }

  const definitions: RemoteToolDefinition[] = [];
  for (const candidate of value.tools) {
    const definition = parseRemoteToolDefinition(candidate);
    if (!definition) return undefined;
    definitions.push(definition);
  }
  return definitions;
}

function createIntegrationRequestSignalScope(
  callerSignal: AbortSignal | undefined,
): IntegrationRequestSignalScope {
  callerSignal?.throwIfAborted();

  const controller = new AbortController();
  const forwardCallerAbort = () => controller.abort(callerSignal?.reason);
  const timeoutId = setTimeout(() => {
    controller.abort(
      new DOMException(
        `Integration API request timed out after ${INTEGRATION_REQUEST_TIMEOUT_MS} ms`,
        "TimeoutError",
      ),
    );
  }, INTEGRATION_REQUEST_TIMEOUT_MS);
  const detachCaller = () => {
    callerSignal?.removeEventListener("abort", forwardCallerAbort);
  };
  const cleanupAfterAbort = () => {
    clearTimeout(timeoutId);
    detachCaller();
  };
  controller.signal.addEventListener("abort", cleanupAfterAbort, { once: true });

  if (callerSignal) {
    callerSignal.addEventListener("abort", forwardCallerAbort, { once: true });
    // An abort can race the initial check and listener registration.
    if (callerSignal.aborted) forwardCallerAbort();
  }

  let disposed = false;
  return {
    signal: controller.signal,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(timeoutId);
      detachCaller();
      controller.signal.removeEventListener("abort", cleanupAfterAbort);
    },
  };
}

function discardResponseBody(response: Response): void {
  if (!response.body) return;

  try {
    const cancellation = response.body.cancel();
    void cancellation.catch((error) => {
      logger.debug("Failed to discard integration API response body", {
        status: response.status,
        errorName: error instanceof Error ? error.name : typeof error,
      });
    });
  } catch (error) {
    logger.debug("Failed to discard integration API response body", {
      status: response.status,
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

function assertResponseContentLengthWithin(
  response: Response,
  maxBytes: number,
  label: string,
): void {
  const rawContentLength = response.headers.get("content-length");
  if (rawContentLength === null) return;

  const contentLength = Number(rawContentLength.trim());
  if (
    !/^\d+$/.test(rawContentLength.trim()) ||
    !Number.isSafeInteger(contentLength) ||
    contentLength > maxBytes
  ) {
    discardResponseBody(response);
    throw new Error(`${label} exceeds the ${maxBytes}-byte response limit`);
  }
}

async function readBoundedResponseJson(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
  label: string,
): Promise<unknown> {
  assertResponseContentLengthWithin(response, maxBytes, label);
  const { text, truncated } = await readResponseTextPrefix(
    response,
    maxBytes + 1,
    signal,
    { fatalUtf8: true },
  );
  if (truncated || utf8Encoder.encode(text).byteLength > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte response limit`);
  }

  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new SyntaxError(`${label} is not valid JSON`, { cause });
  }
}

function snapshotRemoteToolArguments(
  args: Record<string, unknown>,
): Record<string, BoundedJsonValue> {
  const snapshot = snapshotBoundedJsonValue(args);
  if (!snapshot.success || !isRecord(snapshot.value)) {
    throw new TypeError(
      "Remote integration tool arguments must be a bounded JSON object without accessors or cycles",
    );
  }
  return snapshot.value;
}

function serializeCallRequest(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext | undefined,
): string {
  for (
    const [label, value] of [
      ["run id", context?.runId],
      ["agent id", context?.agentId],
    ] as const
  ) {
    if (
      value !== undefined &&
      (typeof value !== "string" || value.length > MAX_REMOTE_INTEGRATION_CONTEXT_ID_LENGTH)
    ) {
      throw new RangeError(
        `Integration tool call ${label} exceeds the ${MAX_REMOTE_INTEGRATION_CONTEXT_ID_LENGTH}-character limit`,
      );
    }
  }

  const body = {
    name: toolName,
    arguments: snapshotRemoteToolArguments(args),
    ...(context?.runId !== undefined ? { run_id: context.runId } : {}),
    ...(context?.agentId !== undefined ? { agent_id: context.agentId } : {}),
  };
  const serialized = JSON.stringify(body);
  if (utf8Encoder.encode(serialized).byteLength > MAX_INTEGRATION_CALL_REQUEST_BYTES) {
    throw new RangeError(
      `Integration tool call request exceeds the ${MAX_INTEGRATION_CALL_REQUEST_BYTES}-byte limit`,
    );
  }
  return serialized;
}

/**
 * Issue an authenticated POST to the integration tools API with a bounded
 * timeout. The two endpoints have different response contracts — tools/list
 * throws on failure while tools/call maps failures into a structured result —
 * so callers own response handling and request-signal lifetime; this
 * centralizes authenticated dispatch. No retry: tools/call is not idempotent
 * (a retried call could re-send an email or re-create a record).
 */
async function postIntegrationApi(
  baseUrl: string,
  path: string,
  token: string,
  serializedBody: string | undefined,
  context: ToolExecutionContext | undefined,
  signal: AbortSignal,
): Promise<Response> {
  const projectSlug = resolveRequestProjectSlug(context);
  signal.throwIfAborted();

  return await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(projectSlug ? { "x-veryfront-project-slug": projectSlug } : {}),
    },
    ...(serializedBody !== undefined ? { body: serializedBody } : {}),
    signal,
  });
}

async function fetchToolList(
  baseUrl: string,
  token: string,
  context?: ToolExecutionContext,
): Promise<RemoteToolDefinition[]> {
  const requestScope = createIntegrationRequestSignalScope(context?.abortSignal);
  try {
    const response = await postIntegrationApi(
      baseUrl,
      "/integrations/tools/list",
      token,
      undefined,
      context,
      requestScope.signal,
    );

    if (!response.ok) {
      // Throw so callers can distinguish a fetch failure from "no remote tools
      // available" (which returns an empty tools array with status 200).
      discardResponseBody(response);
      throw new Error(
        `Integration tools API returned ${response.status} ${response.statusText}`.trim(),
      );
    }

    const rawData = await readBoundedResponseJson(
      response,
      MAX_INTEGRATION_TOOL_LIST_RESPONSE_BYTES,
      requestScope.signal,
      "Integration tools API list response",
    );
    const definitions = parseToolListResponse(rawData);
    if (!definitions) {
      throw new Error("Integration tools API returned unexpected response shape");
    }
    return definitions;
  } finally {
    requestScope.dispose();
  }
}

async function callRemoteTool(
  baseUrl: string,
  token: string,
  toolName: string,
  args: Record<string, unknown>,
  context?: ToolExecutionContext,
): Promise<unknown> {
  const requestScope = createIntegrationRequestSignalScope(context?.abortSignal);
  try {
    const serializedBody = serializeCallRequest(toolName, args, context);
    const response = await postIntegrationApi(
      baseUrl,
      "/integrations/tools/call",
      token,
      serializedBody,
      context,
      requestScope.signal,
    );

    if (!response.ok) {
      const { text } = await readResponseTextPrefix(
        response,
        MAX_INTEGRATION_API_ERROR_RESPONSE_BYTES,
        requestScope.signal,
        { fatalUtf8: true },
      );
      return { error: "api_error", status: response.status, message: text };
    }

    const rawResult = await readBoundedResponseJson(
      response,
      MAX_INTEGRATION_TOOL_CALL_RESPONSE_BYTES,
      requestScope.signal,
      "Integration tools API call response",
    );
    const resultSnapshot = snapshotBoundedJsonValue(rawResult);
    if (!resultSnapshot.success) {
      throw new TypeError(
        "Integration tools API call response exceeds bounded JSON shape limits",
      );
    }
    const result = resultSnapshot.value;

    // If MCP CallToolResult format, extract content.
    if (isRecord(result) && Array.isArray(result.content)) {
      const text = joinCallToolText(result.content);

      if (result.structuredContent) {
        return result.structuredContent;
      }

      if (result.isError) {
        // Preserve structured errors such as authentication_required + connectUrl.
        const parsed = parseJsonText(text);
        if (parsed && typeof parsed === "object") return parsed;
        return { error: "tool_error", message: text };
      }

      return parseJsonText(text) ?? text;
    }

    return result;
  } finally {
    requestScope.dispose();
  }
}

// ---------------------------------------------------------------------------
// Public API — called by agent runtime per-request
// ---------------------------------------------------------------------------

/**
 * Fetch integration tool definitions for the current request context.
 * Returns ToolDefinition[] that the agent runtime merges into the model's
 * available tools. Returns empty array if no API config or no tools.
 *
 * Called per agent loop iteration — results are scoped to the current
 * project's authorized integration tools via the per-request API token.
 * Caller cancellation is propagated; remote failures and malformed or
 * over-limit catalogs fail closed to an empty list.
 */
export async function getRemoteIntegrationToolDefinitions(
  context?: ToolExecutionContext,
): Promise<
  ToolDefinition[]
> {
  context?.abortSignal?.throwIfAborted();
  const baseUrl = getApiBaseUrlEnv();
  const token = resolveRequestToken(context);
  if (!baseUrl || !token) return [];

  try {
    const remoteDefs = await fetchToolList(baseUrl, token, context);
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
    context?.abortSignal?.throwIfAborted();
    logger.error("Failed to fetch remote integration tool definitions", {
      error: err instanceof Error ? err.message : String(err),
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
 * The request, response, and caller-supplied cancellation signal remain
 * bounded for the complete network and response-body lifecycle.
 */
export async function executeRemoteIntegrationTool(
  toolName: string,
  args: Record<string, unknown>,
  context?: ToolExecutionContext,
): Promise<unknown> {
  context?.abortSignal?.throwIfAborted();
  if (
    toolName.length > MAX_REMOTE_INTEGRATION_TOOL_NAME_LENGTH ||
    !isRemoteIntegrationTool(toolName)
  ) {
    throw new Error(
      `Remote integration tool "${toolName}" must use the canonical integration__tool_id name`,
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
  const token = resolveRequestToken(context);
  if (!baseUrl || !token) {
    return { error: "no_api_token", message: "No API token available" };
  }

  return callRemoteTool(
    baseUrl,
    token,
    toolName,
    args,
    context,
  );
}
