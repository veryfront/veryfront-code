/**
 * Remote Integration Tools
 *
 * Fetches integration tool definitions from the API and executes calls through
 * integration-scoped and tool-scoped API routes. Discovery keeps the combined list
 * route during the compatibility window until the API exposes the configured
 * integration identities needed to issue scoped list requests without an N+1.
 *
 * Design: NO global registration. Tools are fetched per-request because
 * different projects expose different authorized integration tools. The agent runtime
 * calls these functions at tool-enumeration and tool-execution time.
 */

import { getApiBaseUrlEnv, getApiTokenEnv } from "#veryfront/config/env.ts";
import { getEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import {
  requireHostPrivateApiHttps,
  resolveHostOwnedApiBaseUrl,
} from "#veryfront/config/host-api-base.ts";
import { defineError, retryWithBackoff, VeryfrontError } from "#veryfront/errors";
import { AsyncLocalStorage } from "#veryfront/platform/compat/async-context.ts";
import { getActiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import {
  isIntegrationToolAllowedBySourcePolicy,
  parseIntegrationToolIdentity,
} from "#veryfront/integrations/source-policy.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { getHostEnv, getHostSecret } from "#veryfront/platform/compat/process/env.ts";
import { guardedOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import { createVeryfrontApiRequestUrlResolver } from "#veryfront/platform/adapters/veryfront-api-url.ts";
import { type BoundedJsonValue, snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { logger } from "#veryfront/utils";
import {
  hasProjectIdentityControlCharacters,
  isCanonicalProjectSlug,
} from "#veryfront/utils/project-identity.ts";
import {
  InvalidResponseBodyError,
  readResponseTextPrefix,
} from "#veryfront/utils/response-body.ts";

import type { ToolDefinition, ToolExecutionContext } from "#veryfront/tool";
import {
  INTEGRATION_REQUEST_TIMEOUT_MS,
  INTEGRATION_TOOL_LIST_RETRY_DELAY_MS,
  MAX_INTEGRATION_API_ERROR_RESPONSE_BYTES,
  MAX_INTEGRATION_CALL_REQUEST_BYTES,
  MAX_INTEGRATION_TOOL_CALL_RESPONSE_BYTES,
  MAX_INTEGRATION_TOOL_LIST_ATTEMPTS,
  MAX_INTEGRATION_TOOL_LIST_RESPONSE_BYTES,
  MAX_REMOTE_INTEGRATION_API_TOKEN_LENGTH,
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

/**
 * A non-2xx response from the integration tools API. Instances carry the
 * upstream status as their own status, so discovery can tell an unusable
 * request apart from a real service failure.
 */
const INTEGRATION_TOOL_LIST_REQUEST_FAILED = defineError({
  slug: "integration-tool-list-request-failed",
  category: "RUNTIME",
  status: 502,
  title: "Integration tools API request failed",
  suggestion: "Check the integration API base URL and credential, then retry",
});

interface RemoteIntegrationExecutionContext {
  readonly hasExplicitCredential: boolean;
  readonly authToken: unknown;
  readonly projectSlug: unknown;
  readonly runId: unknown;
  readonly agentId: unknown;
  readonly abortSignal: AbortSignal | undefined;
}

/** Result of listing the integration tools available to the current run. */
export type RemoteIntegrationToolDiscoveryResult =
  | { readonly status: "ok"; readonly tools: ToolDefinition[] }
  | { readonly status: "unavailable"; readonly reason: "request_failed" };

type RemoteIntegrationToolCatalogResult =
  | { readonly status: "ok"; readonly tools: RemoteToolDefinition[] }
  | { readonly status: "unavailable"; readonly reason: "request_failed" };

interface RemoteIntegrationToolDiscoveryCacheEntry {
  readonly toolListUrl: string;
  readonly token: string;
  readonly projectSlug: string | undefined;
  readonly result: Promise<RemoteIntegrationToolCatalogResult>;
}

interface RemoteIntegrationToolDiscoveryScope {
  entry?: RemoteIntegrationToolDiscoveryCacheEntry;
}

const remoteIntegrationToolDiscoveryStorage = new AsyncLocalStorage<
  RemoteIntegrationToolDiscoveryScope
>();
const requestIntegrationToolDiscoveryScopes = new WeakMap<
  object,
  RemoteIntegrationToolDiscoveryScope
>();

const utf8Encoder = new TextEncoder();
const EMPTY_REMOTE_INTEGRATION_CONTEXT: RemoteIntegrationExecutionContext = Object.freeze({
  hasExplicitCredential: false,
  authToken: undefined,
  projectSlug: undefined,
  runId: undefined,
  agentId: undefined,
  abortSignal: undefined,
});

/** Run a callback with one integration-tool discovery result shared by all continuations. */
export function runWithRemoteIntegrationToolDiscoveryScope<T>(
  callback: () => Promise<T>,
): Promise<T> {
  return remoteIntegrationToolDiscoveryStorage.run({}, callback);
}

function getRemoteIntegrationToolDiscoveryScope():
  | RemoteIntegrationToolDiscoveryScope
  | undefined {
  const runScope = remoteIntegrationToolDiscoveryStorage.getStore();
  if (runScope) return runScope;

  const requestContext = getCurrentRequestContext();
  if (!requestContext) return undefined;

  let requestScope = requestIntegrationToolDiscoveryScopes.get(requestContext);
  if (!requestScope) {
    requestScope = {};
    requestIntegrationToolDiscoveryScopes.set(requestContext, requestScope);
  }
  return requestScope;
}

function snapshotToolExecutionContext(
  context: ToolExecutionContext | undefined,
  includeCallMetadata: boolean,
): RemoteIntegrationExecutionContext {
  if (context === undefined) return EMPTY_REMOTE_INTEGRATION_CONTEXT;
  if (typeof context !== "object" || context === null) {
    throw new TypeError("Integration tool execution context must be an object");
  }

  const readOwnDataProperty = (key: string): { present: boolean; value: unknown } => {
    const descriptor = Reflect.getOwnPropertyDescriptor(context, key);
    if (!descriptor) return { present: false, value: undefined };
    if (!("value" in descriptor)) {
      throw new TypeError(
        `Integration tool execution context property "${key}" must be a data property`,
      );
    }
    return { present: true, value: descriptor.value };
  };

  try {
    const authToken = readOwnDataProperty("authToken");
    const projectSlug = authToken.present
      ? readOwnDataProperty("projectSlug")
      : { present: false, value: undefined };
    const runId = includeCallMetadata
      ? readOwnDataProperty("runId")
      : { present: false, value: undefined };
    const agentId = includeCallMetadata
      ? readOwnDataProperty("agentId")
      : { present: false, value: undefined };
    // Strict `=== false` only: an absent marker means the id is a real
    // control-plane run and stays bindable.
    const runIdBinds = includeCallMetadata
      ? readOwnDataProperty("runIdBindsToolAuthorization")
      : { present: false, value: undefined };
    const abortSignal = readOwnDataProperty("abortSignal");
    if (
      abortSignal.value !== undefined &&
      !(abortSignal.value instanceof AbortSignal)
    ) {
      throw new TypeError("Integration tool execution context abortSignal must be an AbortSignal");
    }

    return Object.freeze({
      hasExplicitCredential: authToken.present,
      authToken: authToken.value,
      projectSlug: projectSlug.value,
      runId: runIdBinds.value === false ? undefined : runId.value,
      agentId: agentId.value,
      abortSignal: abortSignal.value as AbortSignal | undefined,
    });
  } catch (cause) {
    throw new TypeError("Invalid integration tool execution context", { cause });
  }
}

// ---------------------------------------------------------------------------
// Per-request token resolution
// ---------------------------------------------------------------------------

// Captured before project code runs: `resolveRequestAuth` passes the
// host-private stored login token through this validator, so a project that
// replaces `String.prototype.charCodeAt` must not observe the credential from
// the method receiver.
const applyIntrinsic = Reflect.apply;
const stringCharCodeAt = String.prototype.charCodeAt;

function isValidApiToken(token: unknown): token is string {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_REMOTE_INTEGRATION_API_TOKEN_LENGTH
  ) {
    return false;
  }
  for (let index = 0; index < token.length; index++) {
    const code = applyIntrinsic(stringCharCodeAt, token, [index]) as number;
    if (code < 0x21 || code > 0x7e) return false;
  }
  return true;
}

/**
 * Resolve the API token for the active runtime mode.
 * Proxy mode requires a valid request-scoped project token. Single-project
 * runtimes may use their process-wide environment token.
 */
function resolveRequestAuth(
  context: RemoteIntegrationExecutionContext,
): { baseUrl: string; token: string | undefined } {
  const baseUrl = getApiBaseUrlEnv();
  if (context.hasExplicitCredential) {
    return {
      baseUrl,
      token: isValidApiToken(context.authToken) ? context.authToken : undefined,
    };
  }

  const requestContext = getCurrentRequestContext();
  if (requestContext) {
    const token = isValidApiToken(requestContext.token) ? requestContext.token : undefined;
    return {
      baseUrl: token !== undefined && token === getHostSecret("VERYFRONT_API_TOKEN")
        ? requireHostPrivateApiHttps(resolveHostOwnedApiBaseUrl())
        : baseUrl,
      token,
    };
  }
  if (getEnvironmentConfig().proxyMode) return { baseUrl, token: undefined };

  // Single-project runtimes may also authenticate from a stored
  // `veryfront login`. That credential is registered host-privately rather than
  // exported into the process environment, so it never reaches the environment snapshot
  // `getApiTokenEnv()` reads; `getHostEnv` is the only reader that resolves it
  // and project code cannot reach it. Without this fallback a CLI-authenticated
  // `dev`, `start`, or `eval` run discovers no integration tools and every call
  // fails with `no_api_token`.
  // An unusable exported value (blank, or otherwise not a valid token) must not
  // shadow the stored credential, so the snapshot only wins when it is valid.
  const environmentToken = getApiTokenEnv();
  if (isValidApiToken(environmentToken)) return { baseUrl, token: environmentToken };

  const hostToken = getHostEnv("VERYFRONT_API_TOKEN");
  if (!isValidApiToken(hostToken)) return { baseUrl, token: undefined };
  return {
    baseUrl: requireHostPrivateApiHttps(resolveHostOwnedApiBaseUrl()),
    token: hostToken,
  };
}

function normalizeProjectSlug(projectSlug: unknown): string | undefined {
  if (projectSlug === undefined) return undefined;
  if (typeof projectSlug !== "string") {
    throw new TypeError("Integration project slug must be a string");
  }
  const normalized = projectSlug.trim();
  if (normalized.length === 0) return undefined;
  if (!isCanonicalProjectSlug(normalized)) {
    throw new TypeError("Integration project slug must be canonical");
  }
  return normalized;
}

function resolveRequestProjectSlug(
  context: RemoteIntegrationExecutionContext,
): string | undefined {
  if (context.hasExplicitCredential) {
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
  const names = new Set<string>();
  for (const candidate of value.tools) {
    const definition = parseRemoteToolDefinition(candidate);
    if (!definition || names.has(definition.name)) return undefined;
    names.add(definition.name);
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
  args: Record<string, unknown>,
  context: RemoteIntegrationExecutionContext,
): string {
  for (
    const [label, value] of [
      ["run id", context.runId],
      ["agent id", context.agentId],
    ] as const
  ) {
    if (value === undefined) continue;
    if (typeof value !== "string") {
      throw new TypeError(`Integration tool call ${label} must be a string`);
    }
    if (value.length > MAX_REMOTE_INTEGRATION_CONTEXT_ID_LENGTH) {
      throw new RangeError(
        `Integration tool call ${label} exceeds the ${MAX_REMOTE_INTEGRATION_CONTEXT_ID_LENGTH}-character limit`,
      );
    }
    if (
      value.length === 0 ||
      value !== value.trim() ||
      hasProjectIdentityControlCharacters(value)
    ) {
      throw new TypeError(`Integration tool call ${label} must be a canonical identifier`);
    }
  }

  const body = {
    arguments: snapshotRemoteToolArguments(args),
    ...(context.runId !== undefined ? { run_id: context.runId } : {}),
    ...(context.agentId !== undefined ? { agent_id: context.agentId } : {}),
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
 * timeout. Discovery and execution have different response contracts: tool
 * listing throws on failure while tool calls map failures into a structured result,
 * so callers own response handling and request-signal lifetime; this
 * centralizes authenticated dispatch. No retry: tool execution is not idempotent
 * (a retried call could re-send an email or re-create a record).
 */
async function postIntegrationApi(
  requestUrl: string,
  token: string,
  serializedBody: string | undefined,
  projectSlug: string | undefined,
  signal: AbortSignal,
): Promise<Response> {
  signal.throwIfAborted();

  // The credential may be the host-private stored login token, so the request
  // goes through the host transport rather than `globalThis.fetch`. Locally
  // loaded project code runs in this process and can replace the global, and a
  // direct call would hand its replacement the `Authorization` header to read.
  //
  // This also puts the call under the host egress ceiling, which denies private
  // and loopback destinations. A deployment that points `VERYFRONT_API_URL` /
  // `VERYFRONT_API_BASE_URL` at an internal host must set
  // `VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS`; that is the intended disposition,
  // since only the host process can set it and a project overlay cannot.
  return await guardedOutboundFetch(requestUrl, {
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

async function fetchToolListAttempt(
  toolListUrl: string,
  token: string,
  projectSlug: string | undefined,
  signal: AbortSignal,
): Promise<RemoteToolDefinition[]> {
  const response = await postIntegrationApi(
    toolListUrl,
    token,
    undefined,
    projectSlug,
    signal,
  );

  if (!response.ok) {
    // Throw so callers can distinguish a fetch failure from "no remote tools
    // available" (which returns an empty tools array with status 200).
    discardResponseBody(response);
    throw INTEGRATION_TOOL_LIST_REQUEST_FAILED.create({
      message: `Integration tools API returned ${response.status} ${response.statusText}`.trim(),
      status: response.status,
    });
  }

  const rawData = await readBoundedResponseJson(
    response,
    MAX_INTEGRATION_TOOL_LIST_RESPONSE_BYTES,
    signal,
    "Integration tools API list response",
  );
  const definitions = parseToolListResponse(rawData);
  if (!definitions) {
    throw new Error("Integration tools API returned unexpected response shape");
  }
  return definitions;
}

function createIntegrationRequestTimeoutError(): DOMException {
  return new DOMException(
    `Integration API request timed out after ${INTEGRATION_REQUEST_TIMEOUT_MS} ms`,
    "TimeoutError",
  );
}

async function fetchToolList(
  toolListUrl: string,
  token: string,
  projectSlug: string | undefined,
  context: RemoteIntegrationExecutionContext,
): Promise<RemoteToolDefinition[]> {
  return await retryWithBackoff(
    async (signal) => {
      if (!signal) {
        throw new Error("Integration tool discovery retry signal is unavailable");
      }
      try {
        return await fetchToolListAttempt(toolListUrl, token, projectSlug, signal);
      } catch (error) {
        context.abortSignal?.throwIfAborted();
        if (signal.aborted && error === signal.reason) {
          throw createIntegrationRequestTimeoutError();
        }
        throw error;
      }
    },
    {
      abortSignal: context.abortSignal,
      maxAttempts: MAX_INTEGRATION_TOOL_LIST_ATTEMPTS,
      timeoutMs: INTEGRATION_REQUEST_TIMEOUT_MS,
      shouldRetry: isTransientToolListFailure,
      computeDelay: (attempt) => INTEGRATION_TOOL_LIST_RETRY_DELAY_MS * (attempt + 1),
      onRetry: ({ error, attempt }) => {
        logger.debug("Retrying remote integration tool discovery after a transient failure", {
          attempt: attempt + 1,
          error: error.message,
        });
      },
    },
  );
}

/**
 * Transient tool-list failures worth another attempt: transport TypeErrors
 * from fetch dispatch or body streaming, and 5xx responses. Deterministic
 * response validation errors and request timeouts are not retried.
 */
function isTransientToolListFailure(err: unknown): boolean {
  if (
    err instanceof VeryfrontError &&
    err.slug === INTEGRATION_TOOL_LIST_REQUEST_FAILED.slug
  ) {
    return typeof err.status === "number" && err.status >= 500;
  }
  return err instanceof TypeError && !(err instanceof InvalidResponseBodyError);
}

async function discoverRemoteIntegrationToolCatalog(
  toolListUrl: string,
  token: string,
  projectSlug: string | undefined,
  context: RemoteIntegrationExecutionContext,
): Promise<RemoteIntegrationToolCatalogResult> {
  try {
    return {
      status: "ok",
      tools: await fetchToolList(toolListUrl, token, projectSlug, context),
    };
  } catch (err) {
    context.abortSignal?.throwIfAborted();
    const error = err instanceof Error ? err.message : String(err);
    // The tools endpoint is project scoped. A runtime with no project slug and
    // a credential that carries no project claim — an unlinked local project
    // running on a `veryfront login` session — is rejected with 400. That is
    // the expected state for a project with no integrations, not a failure the
    // developer can act on, so it must not surface as an error.
    if (
      projectSlug === undefined &&
      err instanceof VeryfrontError &&
      err.slug === INTEGRATION_TOOL_LIST_REQUEST_FAILED.slug &&
      err.status === 400
    ) {
      logger.debug("Skipped remote integration tools: no project scope for this runtime", {
        error,
      });
      return { status: "unavailable", reason: "request_failed" };
    }
    logger.error("Failed to fetch remote integration tool definitions", { error });
    return { status: "unavailable", reason: "request_failed" };
  }
}

function getRemoteIntegrationToolCatalog(
  toolListUrl: string,
  token: string,
  projectSlug: string | undefined,
  context: RemoteIntegrationExecutionContext,
): Promise<RemoteIntegrationToolCatalogResult> {
  const scope = getRemoteIntegrationToolDiscoveryScope();
  const cached = scope?.entry;
  if (
    cached?.toolListUrl === toolListUrl &&
    cached.token === token &&
    cached.projectSlug === projectSlug
  ) {
    return cached.result;
  }

  const result = discoverRemoteIntegrationToolCatalog(toolListUrl, token, projectSlug, context);
  if (scope) {
    const entry: RemoteIntegrationToolDiscoveryCacheEntry = {
      toolListUrl,
      token,
      projectSlug,
      result,
    };
    scope.entry = entry;
    void result.catch(() => {
      if (scope.entry === entry) scope.entry = undefined;
    });
  }
  return result;
}

async function callRemoteTool(
  baseUrl: string,
  token: string,
  integration: string,
  toolId: string,
  args: Record<string, unknown>,
  context: RemoteIntegrationExecutionContext,
): Promise<unknown> {
  const requestScope = createIntegrationRequestSignalScope(context.abortSignal);
  try {
    const serializedBody = serializeCallRequest(args, context);
    const projectSlug = resolveRequestProjectSlug(context);
    const requestUrl = createVeryfrontApiRequestUrlResolver(baseUrl)(
      `/integrations/${encodeURIComponent(integration)}/tools/${encodeURIComponent(toolId)}/call`,
    );
    const response = await postIntegrationApi(
      requestUrl,
      token,
      serializedBody,
      projectSlug,
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

      if (Object.hasOwn(result, "structuredContent")) {
        if (!isRecord(result.structuredContent)) {
          throw new TypeError(
            "Integration tools API returned malformed MCP structured content",
          );
        }
        return result.structuredContent;
      }

      if (Object.hasOwn(result, "isError") && typeof result.isError !== "boolean") {
        throw new TypeError("Integration tools API returned a malformed MCP error marker");
      }
      if (result.isError === true) {
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
 * Discover integration tools for the current request context.
 *
 * A successful empty catalog returns `status: "ok"`. Request, protocol, and
 * response failures return `status: "unavailable"` so callers do not mistake
 * a failed lookup for a project with no integration tools. The agent runtime
 * memoizes both outcomes for the current run. Direct callers inside a
 * Veryfront request receive the same request-scoped behavior.
 */
export async function getRemoteIntegrationToolDiscovery(
  context?: ToolExecutionContext,
): Promise<RemoteIntegrationToolDiscoveryResult> {
  const requestContext = snapshotToolExecutionContext(context, false);
  requestContext.abortSignal?.throwIfAborted();
  const { baseUrl, token } = resolveRequestAuth(requestContext);
  if (!baseUrl || !token) return { status: "ok", tools: [] };

  try {
    const toolListUrl = createVeryfrontApiRequestUrlResolver(baseUrl)(
      "/integrations/tools/list",
    );
    const projectSlug = resolveRequestProjectSlug(requestContext);
    const catalog = await getRemoteIntegrationToolCatalog(
      toolListUrl,
      token,
      projectSlug,
      requestContext,
    );
    if (catalog.status === "unavailable") return catalog;

    const sourceIntegrationPolicy = getActiveSourceIntegrationPolicy();
    return {
      status: "ok",
      tools: catalog.tools.filter((def) =>
        sourceIntegrationPolicy === undefined ||
        isIntegrationToolAllowedBySourcePolicy(def.name, sourceIntegrationPolicy)
      ).map((def) => ({
        name: def.name,
        description: def.description,
        parameters: def.inputSchema && Object.keys(def.inputSchema).length > 0
          ? def.inputSchema
          : { type: "object", properties: {} },
      })),
    };
  } catch (err) {
    requestContext.abortSignal?.throwIfAborted();
    logger.error("Failed to fetch remote integration tool definitions", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: "unavailable", reason: "request_failed" };
  }
}

/**
 * Fetch integration tool definitions for the current request context.
 *
 * This compatibility helper returns an empty array for unavailable catalogs.
 * Use `getRemoteIntegrationToolDiscovery` when the caller must distinguish a
 * successful empty catalog from a discovery failure.
 */
export async function getRemoteIntegrationToolDefinitions(
  context?: ToolExecutionContext,
): Promise<ToolDefinition[]> {
  const discovery = await getRemoteIntegrationToolDiscovery(context);
  return discovery.status === "ok" ? discovery.tools : [];
}

/**
 * Check if a tool name looks like a remote integration tool.
 * Integration tools use "integration__tool_id" format (double underscore separator).
 */
export function isRemoteIntegrationTool(toolName: string): boolean {
  return toolName.length <= MAX_REMOTE_INTEGRATION_TOOL_NAME_LENGTH &&
    parseIntegrationToolIdentity(toolName) !== null;
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
  const requestContext = snapshotToolExecutionContext(context, true);
  requestContext.abortSignal?.throwIfAborted();
  if (typeof toolName !== "string") {
    throw new Error(
      `Remote integration tool "${toolName}" must use the canonical integration__tool_id name`,
    );
  }
  if (toolName.length > MAX_REMOTE_INTEGRATION_TOOL_NAME_LENGTH) {
    throw new Error(
      `Remote integration tool name must not exceed ${MAX_REMOTE_INTEGRATION_TOOL_NAME_LENGTH} characters`,
    );
  }

  const identity = parseIntegrationToolIdentity(toolName);
  if (identity === null) {
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

  const { baseUrl, token } = resolveRequestAuth(requestContext);
  if (!baseUrl || !token) {
    return { error: "no_api_token", message: "No API token available" };
  }

  return callRemoteTool(
    baseUrl,
    token,
    identity.integration,
    identity.toolId,
    args,
    requestContext,
  );
}
