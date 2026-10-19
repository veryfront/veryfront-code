/**
 * Local Outlook app-only (client-credentials) integration tools.
 *
 * This source is opt-in. Materialize its tools with
 * `loadRemoteToolsFromSource` and pass the result through an agent's `tools`
 * field. It calls Microsoft Graph as one configured mailbox, never `/me`, and
 * never sends Microsoft credentials to Veryfront APIs.
 */

import { getEnv } from "#veryfront/platform/compat/process.ts";
import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "#veryfront/tool";
import { connectors } from "./_data.ts";
import { guardLocalCredentialSource } from "./local-credential-host-policy.ts";
import {
  executeLocalIntegrationEndpoint,
  executeLocalIntegrationJsonRequest,
  guardedTransport,
  type LocalIntegrationEndpointTransport,
  snapshotLocalIntegrationEndpointInput,
} from "./local-endpoint-executor.ts";
import {
  LOCAL_INTEGRATION_CREDENTIAL_UNAVAILABLE,
  LOCAL_INTEGRATION_CREDENTIALS_MISSING,
  LOCAL_INTEGRATION_REQUEST_FAILED,
  LOCAL_INTEGRATION_REQUEST_INVALID,
  localIntegrationConfigurationError,
  localIntegrationResponseInvalid,
  safeLocalIntegrationIdentifier,
} from "./local-integration-errors.ts";
import { type LocalIntegrationCredentialProvider, toolDefinition } from "./local-tool-source.ts";
import { MAX_LOCAL_INTEGRATION_TOOLS, MAX_REMOTE_INTEGRATION_API_TOKEN_LENGTH } from "./limits.ts";
import type { IntegrationToolMeta } from "./schema.ts";

/** Project environment variables required by the local Outlook service-account source. */
export const OUTLOOK_SERVICE_ACCOUNT_ENV_VARS = [
  "OUTLOOK_SERVICE_ACCOUNT_CLIENT_ID",
  "OUTLOOK_SERVICE_ACCOUNT_CLIENT_SECRET",
  "OUTLOOK_SERVICE_ACCOUNT_TENANT_ID",
  "OUTLOOK_SERVICE_ACCOUNT_MAILBOX",
] as const;

const [CLIENT_ID_ENV, CLIENT_SECRET_ENV, TENANT_ID_ENV, MAILBOX_ENV] =
  OUTLOOK_SERVICE_ACCOUNT_ENV_VARS;
const OUTLOOK_INTEGRATION = "outlook";
const TOKEN_ORIGIN = "https://login.microsoftonline.com";
const GRAPH_ORIGIN = "https://graph.microsoft.com";
const GRAPH_ME_PREFIX = `${GRAPH_ORIGIN}/v1.0/me/`;
const GRAPH_USERS_MAILBOX_PREFIX = `${GRAPH_ORIGIN}/v1.0/users/{mailbox}/`;
const GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const MAX_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1_000;
const MAX_MAILBOX_LENGTH = 320;
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_DOMAIN_PATTERN =
  /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
/** A user principal name; the local part may contain `#`, which is percent-encoded. */
const MAILBOX_ADDRESS_PATTERN = /^[^\s@/\\?%]+@[^\s@/\\?#%]+$/;
/** Token endpoint statuses that point at the client ID, secret or tenant. */
const CREDENTIAL_REJECTION_STATUSES: ReadonlySet<number> = new Set([400, 401, 403]);
const REJECTED_TOKEN = Symbol("rejected token");
/** Catalog tools whose Graph operation supports delegated permissions only. */
const DELEGATED_ONLY_TOOLS: ReadonlySet<string> = new Set(["outlook__find_meeting_times"]);
/** Catalog tools under `/me` whose body names other mailboxes, such as getSchedule's `schedules`. */
const OTHER_MAILBOX_TOOLS: ReadonlySet<string> = new Set([
  "outlook__find_free_time",
  "outlook__get_schedule",
]);

type OutlookEndpoint = NonNullable<IntegrationToolMeta["endpoint"]>;

/** Options for the local Outlook service-account source. */
export interface OutlookServiceAccountToolSourceOptions {
  /** Exact canonical Outlook tool names exposed by this source, such as `outlook__list_emails`. */
  allowedTools: readonly string[];
  /**
   * Grant tools that change mailbox or calendar state, such as
   * `outlook__move_email`. Defaults to `false`, so only read tools can be granted.
   */
  allowWrites?: boolean;
  /** Resolves the service-account variables. Defaults to the active project environment. */
  credentialProvider?: LocalIntegrationCredentialProvider;
}

interface AdmittedOutlookTool {
  readonly id: string;
  readonly endpoint: OutlookEndpoint;
  readonly requiresWrite: boolean | undefined;
  readonly definition: ToolDefinition;
}

interface OutlookServiceAccountConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly tenantId: string;
  readonly mailbox: string;
}

interface CachedToken {
  readonly key: TokenKey;
  readonly authorization: string;
  readonly expiresAt: number;
}

/** Credential values a token was minted for, compared field by field. */
interface TokenKey {
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

function sameTokenKey(a: TokenKey, b: TokenKey): boolean {
  return a.tenantId === b.tenantId && a.clientId === b.clientId &&
    a.clientSecret === b.clientSecret;
}

function configurationError(detail: string): never {
  return localIntegrationConfigurationError(detail);
}

/**
 * Returns the endpoint in `/me/` form, which `executeTool` points at the
 * configured mailbox. A `/users/{mailbox}/` endpoint qualifies when `mailbox`
 * is one path parameter; it is dropped from the caller's inputs, so a caller
 * cannot name another mailbox. Any other endpoint returns `undefined`.
 */
function configuredMailboxEndpoint(endpoint: OutlookEndpoint): OutlookEndpoint | undefined {
  if (endpoint.url.startsWith(GRAPH_ME_PREFIX)) return endpoint;
  if (!endpoint.url.startsWith(GRAPH_USERS_MAILBOX_PREFIX)) return undefined;
  const path = endpoint.url.slice(GRAPH_USERS_MAILBOX_PREFIX.length);
  const { mailbox, ...params } = endpoint.params ?? {};
  if (mailbox?.in !== "path" || path.includes("{mailbox}")) return undefined;
  return { ...endpoint, url: GRAPH_ME_PREFIX + path, params };
}

function admitTool(
  toolName: unknown,
  allowWrites: boolean,
  seen: Set<string>,
  catalog: readonly IntegrationToolMeta[],
): AdmittedOutlookTool {
  if (typeof toolName !== "string") {
    configurationError("Outlook service-account allowed tools must be strings");
  }
  const safeName = safeLocalIntegrationIdentifier(toolName);
  if (!toolName.startsWith(`${OUTLOOK_INTEGRATION}__`)) {
    configurationError(
      `Outlook service-account tool "${safeName}" must use the canonical outlook__tool_id name`,
    );
  }
  if (seen.has(toolName)) {
    configurationError(`Outlook service-account allowed tool "${safeName}" is duplicated`);
  }
  seen.add(toolName);

  const catalogTool = catalog.find((tool) => tool.id === toolName);
  if (!catalogTool?.endpoint) {
    configurationError(`Outlook service-account tool "${safeName}" is unknown`);
  }
  // Copied so a later change to the exported catalog cannot alter a granted tool.
  const endpoint = configuredMailboxEndpoint(structuredClone(catalogTool.endpoint));

  if (DELEGATED_ONLY_TOOLS.has(toolName)) {
    configurationError(
      `Outlook service-account tool "${safeName}" requires delegated access and ` +
        "does not support app-only credentials",
    );
  }
  if (!endpoint || OTHER_MAILBOX_TOOLS.has(toolName)) {
    configurationError(
      `Outlook service-account tool "${safeName}" does not run against the configured mailbox`,
    );
  }
  if (
    endpoint.type === "graphql" || endpoint.response?.enrich ||
    endpoint.bodyMode === "form-data" || endpoint.bodyMode === "raw" ||
    Object.values(endpoint.body ?? {}).some((field) => field.encoding || field.partFilenameField)
  ) {
    configurationError(`Outlook service-account tool "${safeName}" uses an unsupported endpoint`);
  }
  if (catalogTool.requiresWrite === true && !allowWrites) {
    configurationError(
      `Outlook service-account tool "${safeName}" changes mailbox state. ` +
        "Set allowWrites: true to grant it",
    );
  }

  return Object.freeze({
    id: toolName,
    endpoint: Object.freeze(endpoint),
    requiresWrite: catalogTool.requiresWrite,
    definition: toolDefinition(
      { ...structuredClone(catalogTool), id: toolName },
      endpoint,
      OUTLOOK_SERVICE_ACCOUNT_ENV_VARS,
    ),
  });
}

function outlookCatalog(): readonly IntegrationToolMeta[] {
  return connectors.find((entry) => entry.name === OUTLOOK_INTEGRATION)?.tools ?? [];
}

function resolveAllowedTools(
  options: OutlookServiceAccountToolSourceOptions,
  catalog: readonly IntegrationToolMeta[],
): Map<string, AdmittedOutlookTool> {
  const allowedTools = options?.allowedTools;
  if (!Array.isArray(allowedTools) || allowedTools.length === 0) {
    configurationError("Outlook service-account source requires at least one allowed tool");
  }
  if (allowedTools.length > MAX_LOCAL_INTEGRATION_TOOLS) {
    configurationError(
      `Outlook service-account tools exceed the ${MAX_LOCAL_INTEGRATION_TOOLS} tool limit`,
    );
  }
  if (options.allowWrites !== undefined && typeof options.allowWrites !== "boolean") {
    configurationError("Outlook service-account allowWrites must be a boolean");
  }
  const seen = new Set<string>();
  const admitted = new Map<string, AdmittedOutlookTool>();
  for (const toolName of [...allowedTools]) {
    const tool = admitTool(toolName, options.allowWrites === true, seen, catalog);
    admitted.set(tool.id, tool);
  }
  return admitted;
}

async function readVariable(
  provider: LocalIntegrationCredentialProvider,
  name: string,
): Promise<string | undefined> {
  let value: unknown;
  try {
    value = await provider(name);
  } catch {
    throw LOCAL_INTEGRATION_CREDENTIAL_UNAVAILABLE.create({
      detail: `The credential provider could not read ${name} for ${OUTLOOK_INTEGRATION}`,
    });
  }
  if (
    typeof value !== "string" || value.length === 0 || value.trim() !== value ||
    value.length > MAX_REMOTE_INTEGRATION_API_TOKEN_LENGTH ||
    // deno-lint-ignore no-control-regex
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return undefined;
  }
  return value;
}

async function readConfig(
  provider: LocalIntegrationCredentialProvider,
): Promise<OutlookServiceAccountConfig> {
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of OUTLOOK_SERVICE_ACCOUNT_ENV_VARS) {
    const value = await readVariable(provider, name);
    if (value === undefined) missing.push(name);
    else values[name] = value;
  }
  if (missing.length > 0) {
    throw LOCAL_INTEGRATION_CREDENTIALS_MISSING.create({
      detail: `Set local integration credential variables: ${missing.join(", ")}`,
    });
  }

  const tenantId = values[TENANT_ID_ENV]!;
  if (!GUID_PATTERN.test(tenantId) && !TENANT_DOMAIN_PATTERN.test(tenantId)) {
    configurationError(
      `${TENANT_ID_ENV} must be a Microsoft Entra tenant ID or verified domain name`,
    );
  }
  const mailbox = values[MAILBOX_ENV]!;
  if (
    mailbox.length > MAX_MAILBOX_LENGTH ||
    (!GUID_PATTERN.test(mailbox) && !MAILBOX_ADDRESS_PATTERN.test(mailbox))
  ) {
    configurationError(
      `${MAILBOX_ENV} must be a user principal name or Microsoft Entra user ID`,
    );
  }
  return Object.freeze({
    clientId: values[CLIENT_ID_ENV]!,
    clientSecret: values[CLIENT_SECRET_ENV]!,
    tenantId,
    mailbox,
  });
}

/** Wraps a transport so the caller can read the last response status. */
function observeStatus(
  transport: LocalIntegrationEndpointTransport,
): { transport: LocalIntegrationEndpointTransport; status(): number | undefined } {
  let status: number | undefined;
  return {
    transport: async (request) => {
      const response = await transport(request);
      status = response.status;
      return response;
    },
    status: () => status,
  };
}

/** Settles with the caller's abort reason without cancelling the shared work. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Outlook IDs may contain `/`, which is sent percent-encoded. A server that
 * decodes `%2F` must still stay in the configured mailbox, so a path argument
 * may not contain a backslash or a `.` or `..` segment.
 */
function assertNoPathTraversal(endpoint: OutlookEndpoint, args: Record<string, unknown>): void {
  for (const [name, field] of Object.entries(endpoint.params ?? {})) {
    const value = args[name];
    if (
      field.in === "path" && typeof value === "string" &&
      (value.includes("\\") || value.split("/").some((part) => part === "." || part === ".."))
    ) {
      throw LOCAL_INTEGRATION_REQUEST_INVALID.create({
        detail: `Outlook argument "${
          safeLocalIntegrationIdentifier(name)
        }" must not contain a backslash or a dot path segment`,
      });
    }
  }
}

function tokenLifetimeMs(value: unknown): number {
  const seconds = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(seconds * 1_000, MAX_TOKEN_LIFETIME_MS) - TOKEN_EXPIRY_SKEW_MS;
}

async function mintToken(
  config: OutlookServiceAccountConfig,
  toolId: string,
  transport: LocalIntegrationEndpointTransport,
): Promise<{ authorization: string; lifetimeMs: number }> {
  const observed = observeStatus(transport);
  const request = executeLocalIntegrationJsonRequest({
    connectorName: OUTLOOK_INTEGRATION,
    toolId,
    url: `${TOKEN_ORIGIN}/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: GRAPH_SCOPE,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }).toString(),
    allowedOrigin: TOKEN_ORIGIN,
    transport: observed.transport,
  });
  let result: Awaited<typeof request>;
  try {
    result = await request;
  } catch (cause) {
    const status = observed.status();
    if (status === undefined || !CREDENTIAL_REJECTION_STATUSES.has(status)) throw cause;
    throw LOCAL_INTEGRATION_REQUEST_FAILED.create({
      detail: `Microsoft Entra rejected the Outlook service-account token request with HTTP ` +
        `status ${status}. Check ${CLIENT_ID_ENV}, ${CLIENT_SECRET_ENV} and ${TENANT_ID_ENV}`,
    });
  }
  const identity = { connectorName: OUTLOOK_INTEGRATION, toolId };
  const response = result.value;
  if (typeof response !== "object" || response === null || Array.isArray(response)) {
    localIntegrationResponseInvalid(identity, result.status);
  }
  const { access_token: accessToken, token_type: tokenType, expires_in: expiresIn } =
    response as Record<string, unknown>;
  if (
    typeof accessToken !== "string" || accessToken.trim().length === 0 ||
    accessToken.length > MAX_REMOTE_INTEGRATION_API_TOKEN_LENGTH ||
    typeof tokenType !== "string" || tokenType.toLowerCase() !== "bearer"
  ) {
    localIntegrationResponseInvalid(identity, result.status);
  }
  return { authorization: `Bearer ${accessToken}`, lifetimeMs: tokenLifetimeMs(expiresIn) };
}

function createOutlookServiceAccountToolSourceInternal(
  options: OutlookServiceAccountToolSourceOptions,
  transport?: LocalIntegrationEndpointTransport,
  now: () => number = Date.now,
  catalog: readonly IntegrationToolMeta[] = outlookCatalog(),
): RemoteToolSource {
  const admitted = resolveAllowedTools(options, catalog);
  const credentialProvider = options.credentialProvider ?? getEnv;
  if (typeof credentialProvider !== "function") {
    configurationError("Outlook service-account credentialProvider must be a function");
  }
  const baseTransport = transport ?? guardedTransport;
  let cachedToken: CachedToken | undefined;
  let pendingToken: { readonly key: TokenKey; readonly promise: Promise<string> } | undefined;

  async function authorization(
    config: OutlookServiceAccountConfig,
    toolId: string,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const key: TokenKey = Object.freeze({
      tenantId: config.tenantId,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });
    if (cachedToken && sameTokenKey(cachedToken.key, key) && now() < cachedToken.expiresAt) {
      return cachedToken.authorization;
    }
    let pending = pendingToken;
    if (!pending || !sameTokenKey(pending.key, key)) {
      cachedToken = undefined;
      // Concurrent callers share one token request. It runs without any one
      // caller's signal, bounded by the executor deadline, so a caller that
      // aborts leaves it running for the others.
      const promise = mintToken(config, toolId, baseTransport).then((minted) => {
        if (minted.lifetimeMs > 0) {
          cachedToken = Object.freeze({
            key,
            authorization: minted.authorization,
            expiresAt: now() + minted.lifetimeMs,
          });
        }
        return minted.authorization;
      });
      const started = Object.freeze({ key, promise });
      pending = pendingToken = started;
      promise.finally(() => {
        if (pendingToken === started) pendingToken = undefined;
      }).catch(() => undefined);
    }
    return await untilAborted(pending.promise, signal);
  }

  return Object.freeze({
    id: "outlook-service-account",
    async listTools(): Promise<ToolDefinition[]> {
      await readConfig(credentialProvider);
      return [...admitted.values()].map((tool) => tool.definition);
    },
    async executeTool(
      toolName: string,
      args: Record<string, unknown>,
      context?: ToolExecutionContext,
    ): Promise<unknown> {
      context?.abortSignal?.throwIfAborted();
      const tool = admitted.get(toolName);
      if (!tool) {
        configurationError(
          `Outlook service-account tool "${
            safeLocalIntegrationIdentifier(toolName)
          }" is not granted by this source`,
        );
      }
      const validated = snapshotLocalIntegrationEndpointInput(tool.endpoint, args);
      assertNoPathTraversal(tool.endpoint, validated.args);
      const config = await readConfig(credentialProvider);
      const endpoint = Object.freeze({
        ...tool.endpoint,
        url: `${GRAPH_ORIGIN}/v1.0/users/${encodeURIComponent(config.mailbox)}/` +
          tool.endpoint.url.slice(GRAPH_ME_PREFIX.length),
      });
      const call = async (authorizationHeader: string, retryable: boolean) => {
        const observed = observeStatus(baseTransport);
        try {
          return await executeLocalIntegrationEndpoint({
            connectorName: OUTLOOK_INTEGRATION,
            toolId: toolName,
            endpoint,
            args: validated.args,
            body: validated.body,
            requiresWrite: tool.requiresWrite,
            authHeaders: { Authorization: authorizationHeader },
            allowedOrigin: GRAPH_ORIGIN,
            signal: context?.abortSignal,
            transport: observed.transport,
          });
        } catch (cause) {
          if (observed.status() !== 401) throw cause;
          // Graph rejected the token, for example after revocation or a
          // consent change. Drop it so no later call reuses it.
          if (cachedToken?.authorization === authorizationHeader) cachedToken = undefined;
          if (!retryable) throw cause;
          return REJECTED_TOKEN;
        }
      };
      const result = await call(
        await authorization(config, toolName, context?.abortSignal),
        true,
      );
      if (result !== REJECTED_TOKEN) return result;
      return await call(await authorization(config, toolName, context?.abortSignal), false);
    },
  });
}

/**
 * Create a local Outlook source that uses Microsoft Entra app-only
 * (client-credentials) access for one configured mailbox.
 */
export function createOutlookServiceAccountToolSource(
  options: OutlookServiceAccountToolSourceOptions,
): RemoteToolSource {
  return guardLocalCredentialSource(createOutlookServiceAccountToolSourceInternal(options));
}

/**
 * @internal Test-only transport, clock and catalog seam without the host grant,
 * which the public factory applies. Not exported from the public integrations module.
 */
export function _createOutlookServiceAccountToolSourceForTesting(
  options: OutlookServiceAccountToolSourceOptions,
  transport: LocalIntegrationEndpointTransport,
  now?: () => number,
  catalog?: readonly IntegrationToolMeta[],
): RemoteToolSource {
  return createOutlookServiceAccountToolSourceInternal(options, transport, now, catalog);
}
