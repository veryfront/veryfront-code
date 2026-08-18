/**
 * Local Salesforce service-account integration tools.
 *
 * This source is opt-in. Materialize its tools with
 * `loadRemoteToolsFromSource` and pass the result through an agent's `tools`
 * field. It never registers globally or sends Salesforce credentials to
 * Veryfront APIs.
 */

import { getEnv } from "#veryfront/platform/compat/process.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { createOriginBoundOutboundFetch } from "#veryfront/security/http/outbound-fetch.ts";
import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "#veryfront/tool";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import { connectors } from "./_data.ts";
import {
  INTEGRATION_REQUEST_TIMEOUT_MS,
  MAX_INTEGRATION_TOOL_CALL_RESPONSE_BYTES,
  MAX_REMOTE_INTEGRATION_API_TOKEN_LENGTH,
} from "./limits.ts";
import type { IntegrationToolMeta } from "./schema.ts";
import { parseIntegrationToolIdentity } from "./source-policy.ts";

/** Host environment variables required by the local Salesforce service-account source. */
export const SALESFORCE_SERVICE_ACCOUNT_ENV_VARS = [
  "SALESFORCE_SERVICE_ACCOUNT_CLIENT_ID",
  "SALESFORCE_SERVICE_ACCOUNT_CLIENT_SECRET",
  "SALESFORCE_SERVICE_ACCOUNT_LOGIN_URL",
] as const;

const [CLIENT_ID_ENV, CLIENT_SECRET_ENV, LOGIN_URL_ENV] = SALESFORCE_SERVICE_ACCOUNT_ENV_VARS;
const SALESFORCE_INTEGRATION = "salesforce";
const SALESFORCE_TOKEN_PATH = "/services/oauth2/token";
const TOKEN_RESPONSE_LIMIT_BYTES = 64 * 1024;
const TOKEN_CACHE_TTL_MS = 5 * 60 * 1_000;

type SalesforceServiceAccountEnvVar = (typeof SALESFORCE_SERVICE_ACCOUNT_ENV_VARS)[number];
type OriginBoundFetchFactory = (baseUrl: string) => typeof fetch;

/** Options for the local Salesforce service-account source. */
export interface SalesforceServiceAccountToolSourceOptions {
  /** Exact canonical Salesforce tool names exposed by this source. */
  allowedTools: readonly string[];
}

interface SalesforceServiceAccountToolSourceTransportOptions
  extends SalesforceServiceAccountToolSourceOptions {
  createOriginBoundFetch: OriginBoundFetchFactory;
}

interface SalesforceCredentials {
  clientId: string;
  clientSecret: string;
  loginOrigin: string;
}

interface SalesforceToken {
  accessToken: string;
  instanceOrigin: string;
}

interface SalesforceTokenCache extends SalesforceToken, SalesforceCredentials {
  expiresAt: number;
}

class SalesforceTokenFailure extends Error {
  constructor(
    readonly kind: "auth" | "api",
    readonly status?: number,
  ) {
    super("Salesforce token request failed");
    this.name = "SalesforceTokenFailure";
  }
}

interface SalesforceEndpointResult {
  status: number;
  result: unknown;
}

interface RequestSignalScope {
  signal: AbortSignal;
  dispose(): void;
}

type SalesforceEndpoint = NonNullable<IntegrationToolMeta["endpoint"]>;
type SalesforceEndpointParam = NonNullable<SalesforceEndpoint["params"]>[string];
type SalesforceEndpointBodyField = NonNullable<SalesforceEndpoint["body"]>[string];
type SalesforceEndpointInput = SalesforceEndpointParam | SalesforceEndpointBodyField;

const salesforceConnector = connectors.find((connector) =>
  connector.name === SALESFORCE_INTEGRATION
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getToolId(tool: IntegrationToolMeta): string | undefined {
  return tool.id ?? tool.name.toLowerCase().replace(/\s+/g, "_");
}

function getSalesforceTool(toolName: string): IntegrationToolMeta | undefined {
  return salesforceConnector?.tools.find((tool) => getToolId(tool) === toolName);
}

function resolveAllowedTools(allowedTools: readonly string[]): readonly IntegrationToolMeta[] {
  if (!Array.isArray(allowedTools) || allowedTools.length === 0) {
    throw new TypeError("Salesforce service-account source requires at least one allowed tool");
  }

  const seen = new Set<string>();
  return Object.freeze(allowedTools.map((toolName) => {
    if (typeof toolName !== "string") {
      throw new TypeError("Salesforce service-account allowed tools must be strings");
    }
    const identity = parseIntegrationToolIdentity(toolName);
    if (
      identity?.integration !== SALESFORCE_INTEGRATION ||
      toolName !== `${identity.integration}__${identity.toolId}`
    ) {
      throw new TypeError(
        `Salesforce service-account tool "${toolName}" must use the canonical salesforce__tool_id name`,
      );
    }
    if (seen.has(toolName)) {
      throw new TypeError(`Salesforce service-account allowed tool "${toolName}" is duplicated`);
    }
    seen.add(toolName);

    const tool = getSalesforceTool(toolName);
    if (!tool?.endpoint) {
      throw new TypeError(`Salesforce service-account tool "${toolName}" is not endpoint-backed`);
    }
    return tool;
  }));
}

function endpointTypeToJsonSchema(
  type: SalesforceEndpointParam["type"],
): Record<string, unknown> {
  switch (type) {
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "string[]":
      return { type: "array", items: { type: "string" } };
    case "object":
      return { type: "object" };
    case "array":
      return { type: "array" };
    default:
      return { type: "string" };
  }
}

function buildToolInputSchema(endpoint: SalesforceEndpoint): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, definition] of Object.entries(endpoint.params ?? {})) {
    if (
      definition.in === "header" &&
      !(definition.required === true && definition.default === undefined)
    ) {
      continue;
    }
    properties[key] = {
      ...endpointTypeToJsonSchema(definition.type),
      description: definition.description,
      ...(definition.exposeDefault === true && definition.default !== undefined
        ? { default: definition.default }
        : {}),
    };
    if (definition.required === true) required.push(key);
  }

  for (const [key, definition] of Object.entries(endpoint.body ?? {})) {
    properties[key] = {
      ...endpointTypeToJsonSchema(definition.type),
      description: definition.description,
    };
    if (definition.required === true) required.push(key);
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function toToolDefinition(tool: IntegrationToolMeta): ToolDefinition {
  const name = getToolId(tool);
  if (!name || !tool.endpoint) {
    throw new TypeError("Salesforce service-account tools require endpoint-backed identifiers");
  }
  const readOnly = tool.requiresWrite !== true;
  const idempotent = ["GET", "PUT", "DELETE"].includes(tool.endpoint.method);
  return {
    name,
    description: tool.description,
    parameters: buildToolInputSchema(tool.endpoint),
    title: tool.name,
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: tool.requiresWrite === true,
      idempotentHint: idempotent,
      openWorldHint: true,
    },
  };
}

function createRequestSignalScope(callerSignal: AbortSignal | undefined): RequestSignalScope {
  callerSignal?.throwIfAborted();
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(callerSignal?.reason);
  const timeout = setTimeout(() => {
    controller.abort(
      new DOMException(
        `Salesforce request timed out after ${INTEGRATION_REQUEST_TIMEOUT_MS} ms`,
        "TimeoutError",
      ),
    );
  }, INTEGRATION_REQUEST_TIMEOUT_MS);

  if (callerSignal) {
    callerSignal.addEventListener("abort", forwardAbort, { once: true });
    if (callerSignal.aborted) forwardAbort();
  }

  let disposed = false;
  return {
    signal: controller.signal,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", forwardAbort);
    },
  };
}

function missingCredentialsResult(missingEnvVars: SalesforceServiceAccountEnvVar[]): unknown {
  const names = missingEnvVars.length === 2
    ? `${missingEnvVars[0]} and ${missingEnvVars[1]}`
    : missingEnvVars.join(", ");
  return {
    error: "missing_credentials",
    integration: SALESFORCE_INTEGRATION,
    missingEnvVars,
    message: `Salesforce service account credentials are not configured. Set ${names}.`,
  };
}

function invalidLoginOriginResult(): unknown {
  return {
    error: "invalid_credentials",
    integration: SALESFORCE_INTEGRATION,
    message: `${LOGIN_URL_ENV} must be a Salesforce My Domain HTTPS origin.`,
  };
}

function authFailureResult(): unknown {
  return {
    error: "salesforce_auth_failed",
    integration: SALESFORCE_INTEGRATION,
    message: "Salesforce service account authentication failed.",
  };
}

function apiFailureResult(status?: number): unknown {
  return {
    error: status === 401 ? "invalid_credentials" : "salesforce_api_error",
    integration: SALESFORCE_INTEGRATION,
    ...(status === undefined ? {} : { status }),
    message: status === 401
      ? "Salesforce rejected the service account credential."
      : "Salesforce API request failed.",
  };
}

function tokenFailureResult(cause: unknown): unknown {
  if (cause instanceof SalesforceTokenFailure && cause.kind === "auth") {
    return authFailureResult();
  }
  return apiFailureResult(cause instanceof SalesforceTokenFailure ? cause.status : undefined);
}

function readCredential(name: SalesforceServiceAccountEnvVar): string | undefined {
  const value = getEnv(name);
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > MAX_REMOTE_INTEGRATION_API_TOKEN_LENGTH
  ) {
    return undefined;
  }
  return value;
}

function parseOrigin(value: string): URL | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.port.length > 0 ||
      url.pathname !== "/" ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

function parseLoginOrigin(value: string): string | undefined {
  const url = parseOrigin(value);
  if (!url || !url.hostname.endsWith(".my.salesforce.com")) return undefined;
  return url.origin;
}

function parseInstanceOrigin(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const url = parseOrigin(value);
  if (
    !url ||
    !url.hostname.endsWith(".salesforce.com") ||
    url.hostname === "login.salesforce.com" ||
    url.hostname === "test.salesforce.com"
  ) {
    return undefined;
  }
  return url.origin;
}

function resolveCredentials():
  | { status: "ok"; credentials: SalesforceCredentials }
  | { status: "missing"; result: unknown }
  | { status: "invalid"; result: unknown } {
  const clientId = readCredential(CLIENT_ID_ENV);
  const clientSecret = readCredential(CLIENT_SECRET_ENV);
  const rawLoginUrl = readCredential(LOGIN_URL_ENV);
  const missingEnvVars = [
    ...(clientId === undefined ? [CLIENT_ID_ENV] : []),
    ...(clientSecret === undefined ? [CLIENT_SECRET_ENV] : []),
    ...(rawLoginUrl === undefined ? [LOGIN_URL_ENV] : []),
  ];
  if (missingEnvVars.length > 0) {
    return { status: "missing", result: missingCredentialsResult(missingEnvVars) };
  }

  const loginOrigin = parseLoginOrigin(rawLoginUrl!);
  if (!loginOrigin) return { status: "invalid", result: invalidLoginOriginResult() };
  return {
    status: "ok",
    credentials: {
      clientId: clientId!,
      clientSecret: clientSecret!,
      loginOrigin,
    },
  };
}

async function readBoundedResponse(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (!/^\d+$/.test(contentLength) || !Number.isSafeInteger(parsed) || parsed > maxBytes) {
      void response.body?.cancel().catch(() => undefined);
      throw new RangeError("Salesforce response exceeds the response limit");
    }
  }
  const { text, truncated } = await readResponseTextPrefix(
    response,
    maxBytes + 1,
    signal,
    { fatalUtf8: true },
  );
  if (truncated || new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new RangeError("Salesforce response exceeds the response limit");
  }
  return text;
}

function parseJsonRecord(text: string): Record<string, unknown> | undefined {
  try {
    const snapshot = snapshotBoundedJsonValue(JSON.parse(text));
    return snapshot.success && isRecord(snapshot.value) ? snapshot.value : undefined;
  } catch {
    return undefined;
  }
}

function snapshotArguments(args: Record<string, unknown>): Record<string, unknown> {
  const snapshot = snapshotBoundedJsonValue(args);
  if (!snapshot.success || !isRecord(snapshot.value)) {
    throw new TypeError("Salesforce tool arguments must be a bounded JSON object");
  }
  return snapshot.value;
}

function credentialsMatch(
  cached: SalesforceTokenCache,
  credentials: SalesforceCredentials,
): boolean {
  return cached.clientId === credentials.clientId &&
    cached.clientSecret === credentials.clientSecret &&
    cached.loginOrigin === credentials.loginOrigin;
}

async function requestSalesforceToken(
  credentials: SalesforceCredentials,
  context: ToolExecutionContext | undefined,
  createOriginBoundFetch: OriginBoundFetchFactory,
): Promise<SalesforceToken> {
  const requestScope = createRequestSignalScope(context?.abortSignal);
  try {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
    });
    const response = await createOriginBoundFetch(credentials.loginOrigin)(
      SALESFORCE_TOKEN_PATH,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        signal: requestScope.signal,
        redirect: "error",
      },
    );
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      const isCredentialRejection = response.status === 400 || response.status === 401;
      throw new SalesforceTokenFailure(
        isCredentialRejection ? "auth" : "api",
        isCredentialRejection ? undefined : response.status,
      );
    }
    const data = parseJsonRecord(
      await readBoundedResponse(response, TOKEN_RESPONSE_LIMIT_BYTES, requestScope.signal),
    );
    const accessToken = data?.access_token;
    const instanceOrigin = parseInstanceOrigin(data?.instance_url);
    if (
      typeof accessToken !== "string" ||
      accessToken.length === 0 ||
      accessToken.length > MAX_REMOTE_INTEGRATION_API_TOKEN_LENGTH ||
      !instanceOrigin
    ) {
      throw new SalesforceTokenFailure("auth");
    }
    return { accessToken, instanceOrigin };
  } finally {
    requestScope.dispose();
  }
}

function isMissingRequiredInput(value: unknown): boolean {
  return value === undefined || value === null ||
    (typeof value === "string" && value.trim().length === 0);
}

function resolveEndpointValue(
  args: Record<string, unknown>,
  key: string,
  definition: SalesforceEndpointParam,
): unknown {
  const value = args[key];
  if (!definition.required && typeof value === "string" && value.trim().length === 0) {
    return definition.default;
  }
  return value === undefined ? definition.default : value;
}

function validateEndpointInputs(
  endpoint: SalesforceEndpoint,
  args: Record<string, unknown>,
): void {
  const missing: string[] = [];
  for (const [key, definition] of Object.entries(endpoint.params ?? {})) {
    const value = resolveEndpointValue(args, key, definition);
    if (
      definition.required === true &&
      definition.default === undefined &&
      isMissingRequiredInput(value)
    ) {
      missing.push(key);
      continue;
    }
    validateEndpointInputType(key, definition, value);
  }
  for (const [key, definition] of Object.entries(endpoint.body ?? {})) {
    const value = args[key] === undefined ? definition.default : args[key];
    if (
      definition.required === true &&
      definition.default === undefined &&
      isMissingRequiredInput(value)
    ) {
      missing.push(key);
      continue;
    }
    validateEndpointInputType(key, definition, value);
  }
  if (missing.length > 0) {
    throw new TypeError(`Missing required Salesforce tool input: ${missing.join(", ")}`);
  }
}

function validateEndpointInputType(
  key: string,
  definition: SalesforceEndpointInput,
  value: unknown,
): void {
  if (value === undefined) return;
  const valid = definition.type === "string"
    ? typeof value === "string"
    : definition.type === "number"
    ? typeof value === "number"
    : definition.type === "boolean"
    ? typeof value === "boolean"
    : definition.type === "string[]"
    ? Array.isArray(value) && value.every((entry) => typeof entry === "string")
    : definition.type === "object"
    ? isRecord(value)
    : definition.type === "array"
    ? Array.isArray(value)
    : false;
  if (!valid) {
    const expected = definition.type === "string[]" ? "string array" : definition.type;
    throw new TypeError(`Salesforce tool input "${key}" must be a ${expected}`);
  }
}

function buildSalesforceRequest(
  endpoint: SalesforceEndpoint,
  args: Record<string, unknown>,
  token: SalesforceToken,
  signal: AbortSignal,
): Request {
  validateEndpointInputs(endpoint, args);
  const templatePrefix = "{{oauth.raw.instance_url}}";
  if (!endpoint.url.startsWith(`${templatePrefix}/`)) {
    throw new TypeError("Salesforce endpoint must use the instance URL template");
  }
  let rawUrl = `${token.instanceOrigin}${endpoint.url.slice(templatePrefix.length)}`;
  for (const [key, definition] of Object.entries(endpoint.params ?? {})) {
    if (definition.in !== "path") continue;
    const value = resolveEndpointValue(args, key, definition);
    if (isMissingRequiredInput(value)) {
      throw new TypeError(`Missing required Salesforce path input: ${key}`);
    }
    rawUrl = rawUrl.replace(`{${key}}`, encodeURIComponent(String(value)));
  }

  const url = new URL(rawUrl);
  if (url.origin !== token.instanceOrigin || rawUrl.includes("{{") || rawUrl.includes("{")) {
    throw new TypeError("Salesforce endpoint resolved outside the authorized instance origin");
  }
  for (const [key, definition] of Object.entries(endpoint.params ?? {})) {
    if (definition.in !== "query") continue;
    const value = resolveEndpointValue(args, key, definition);
    if (value === undefined) continue;
    const queryName = definition.queryName ?? key;
    if (Array.isArray(value)) {
      for (const entry of value) url.searchParams.append(queryName, String(entry));
    } else {
      url.searchParams.set(queryName, String(value));
    }
  }

  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${token.accessToken}`,
  });
  for (const [key, definition] of Object.entries(endpoint.params ?? {})) {
    if (definition.in !== "header") continue;
    const value = resolveEndpointValue(args, key, definition);
    if (value !== undefined) headers.set(definition.headerName ?? key, String(value));
  }

  let body: string | undefined;
  if (endpoint.body && ["POST", "PUT", "PATCH"].includes(endpoint.method)) {
    if (endpoint.bodyMode !== undefined) {
      throw new TypeError("Salesforce local tools do not support non-object request bodies");
    }
    const bodyObject: Record<string, unknown> = {};
    for (const [key, definition] of Object.entries(endpoint.body)) {
      const value = args[key] === undefined ? definition.default : args[key];
      if (value !== undefined) bodyObject[key] = value;
    }
    body = JSON.stringify(bodyObject);
    headers.set("Content-Type", endpoint.contentType ?? "application/json");
  }

  return new Request(url, {
    method: endpoint.method,
    headers,
    body,
    signal,
    redirect: "error",
  });
}

function applyResponseTransform(data: unknown, transform: string | undefined): unknown {
  if (!transform) return data;
  return transform.split(".").reduce<unknown>(
    (value, key) => isRecord(value) ? value[key] : undefined,
    data,
  );
}

async function executeSalesforceEndpoint(
  endpoint: SalesforceEndpoint,
  args: Record<string, unknown>,
  token: SalesforceToken,
  context: ToolExecutionContext | undefined,
  createOriginBoundFetch: OriginBoundFetchFactory,
): Promise<SalesforceEndpointResult> {
  const requestScope = createRequestSignalScope(context?.abortSignal);
  try {
    const request = buildSalesforceRequest(endpoint, args, token, requestScope.signal);
    const response = await createOriginBoundFetch(token.instanceOrigin)(request);
    if (response.status === 204) return { status: 204, result: { success: true } };

    const text = await readBoundedResponse(
      response,
      MAX_INTEGRATION_TOOL_CALL_RESPONSE_BYTES,
      requestScope.signal,
    );
    if (!response.ok) return { status: response.status, result: undefined };

    const contentType = response.headers.get("content-type") ?? "";
    let result: unknown = text;
    if (contentType.includes("application/json")) {
      try {
        const snapshot = snapshotBoundedJsonValue(JSON.parse(text));
        if (!snapshot.success) throw new TypeError("Salesforce response is not bounded JSON");
        result = snapshot.value;
      } catch (cause) {
        throw new TypeError("Salesforce returned an invalid JSON response", { cause });
      }
    }
    return {
      status: response.status,
      result: applyResponseTransform(result, endpoint.response?.transform),
    };
  } finally {
    requestScope.dispose();
  }
}

/**
 * Create a local Salesforce service-account tool source.
 *
 * Materialize the returned source with `loadRemoteToolsFromSource` and pass
 * the result through an agent's `tools` field. The source reads credentials
 * lazily from the host environment when a tool executes.
 */
export function createSalesforceServiceAccountToolSource(
  options: SalesforceServiceAccountToolSourceOptions,
): RemoteToolSource {
  return createSalesforceServiceAccountToolSourceWithTransport({
    ...options,
    createOriginBoundFetch: createOriginBoundOutboundFetch,
  });
}

/** @internal Test seam for the host-owned origin-bound transport. */
export function createSalesforceServiceAccountToolSourceWithTransport(
  options: SalesforceServiceAccountToolSourceTransportOptions,
): RemoteToolSource {
  const allowedTools = resolveAllowedTools(options.allowedTools);
  const definitions = Object.freeze(allowedTools.map(toToolDefinition));
  const toolByName = new Map(allowedTools.map((tool) => [getToolId(tool)!, tool]));
  let tokenCache: SalesforceTokenCache | undefined;

  const getToken = async (
    credentials: SalesforceCredentials,
    context: ToolExecutionContext | undefined,
  ): Promise<SalesforceToken> => {
    if (
      tokenCache &&
      tokenCache.expiresAt > Date.now() &&
      credentialsMatch(tokenCache, credentials)
    ) {
      return {
        accessToken: tokenCache.accessToken,
        instanceOrigin: tokenCache.instanceOrigin,
      };
    }
    const token = await requestSalesforceToken(
      credentials,
      context,
      options.createOriginBoundFetch,
    );
    tokenCache = {
      ...credentials,
      ...token,
      expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
    };
    return token;
  };

  return Object.freeze({
    id: "salesforce-service-account",
    listTools(): Promise<ToolDefinition[]> {
      return Promise.resolve([...definitions]);
    },
    async executeTool(
      toolName: string,
      rawArgs: Record<string, unknown>,
      context?: ToolExecutionContext,
    ): Promise<unknown> {
      context?.abortSignal?.throwIfAborted();
      const tool = toolByName.get(toolName);
      if (!tool?.endpoint) {
        throw new TypeError(`Salesforce tool "${toolName}" is not allowed by this source`);
      }
      const args = snapshotArguments(rawArgs);
      validateEndpointInputs(tool.endpoint, args);
      const credentialResolution = resolveCredentials();
      if (credentialResolution.status !== "ok") return credentialResolution.result;

      let token: SalesforceToken;
      try {
        token = await getToken(credentialResolution.credentials, context);
      } catch (cause) {
        context?.abortSignal?.throwIfAborted();
        return tokenFailureResult(cause);
      }

      let result: SalesforceEndpointResult;
      try {
        result = await executeSalesforceEndpoint(
          tool.endpoint,
          args,
          token,
          context,
          options.createOriginBoundFetch,
        );
      } catch {
        context?.abortSignal?.throwIfAborted();
        return apiFailureResult();
      }

      if (result.status === 401) {
        tokenCache = undefined;
        try {
          token = await getToken(credentialResolution.credentials, context);
        } catch (cause) {
          context?.abortSignal?.throwIfAborted();
          return tokenFailureResult(cause);
        }
        try {
          result = await executeSalesforceEndpoint(
            tool.endpoint,
            args,
            token,
            context,
            options.createOriginBoundFetch,
          );
        } catch {
          context?.abortSignal?.throwIfAborted();
          return apiFailureResult();
        }
      }

      return result.status >= 200 && result.status < 300
        ? result.result
        : apiFailureResult(result.status);
    },
  });
}
