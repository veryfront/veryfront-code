import {
  airtableConfig,
  asanaConfig,
  bitbucketConfig,
  calendarConfig,
  confluenceConfig,
  docsGoogleConfig,
  driveConfig,
  figmaConfig,
  githubConfig,
  gitlabConfig,
  jiraConfig,
  linearConfig,
  notionConfig,
  OAuthService,
  type OAuthServiceConfig,
  oneDriveConfig,
  outlookConfig,
  sharePointConfig,
  sheetsConfig,
  slackConfig,
  teamsConfig,
} from "veryfront/oauth";
import { oauthTokenStore } from "./oauth-store.ts";

const OAUTH_SERVICE_CONFIGS = {
  airtable: airtableConfig,
  asana: asanaConfig,
  bitbucket: bitbucketConfig,
  calendar: calendarConfig,
  confluence: confluenceConfig,
  "docs-google": docsGoogleConfig,
  drive: driveConfig,
  figma: figmaConfig,
  github: githubConfig,
  gitlab: gitlabConfig,
  jira: jiraConfig,
  linear: linearConfig,
  notion: notionConfig,
  onedrive: oneDriveConfig,
  outlook: outlookConfig,
  sharepoint: sharePointConfig,
  sheets: sheetsConfig,
  slack: slackConfig,
  teams: teamsConfig,
} as const satisfies Record<string, OAuthServiceConfig>;

export type OAuthClientService = keyof typeof OAUTH_SERVICE_CONFIGS;

const services = new Map<OAuthClientService, OAuthService>();
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_RESPONSE_LIMIT_BYTES = 10 * 1024 * 1024;
const MAX_EXTERNAL_URL_LENGTH = 8192;

function getOAuthService(serviceId: OAuthClientService): OAuthService {
  let service = services.get(serviceId);
  if (!service) {
    service = new OAuthService(
      OAUTH_SERVICE_CONFIGS[serviceId],
      oauthTokenStore,
    );
    services.set(serviceId, service);
  }
  return service;
}

/**
 * Return a current access token for one authenticated application user.
 * Refresh, response limits, redirects, and atomic storage are delegated to the
 * production-hardened `veryfront/oauth` implementation.
 */
export function getValidToken(
  userId: string,
  serviceId: OAuthClientService,
): Promise<string | null> {
  return getOAuthService(serviceId).getAccessToken(userId);
}

/**
 * Execute a bounded, same-origin OAuth API request with refresh, redirect, and
 * timeout policy enforced by `veryfront/oauth`.
 */
export async function fetchOAuthJson<T>(
  userId: string,
  serviceId: OAuthClientService,
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetchOAuthResponse(
    userId,
    serviceId,
    endpoint,
    options,
  );
  if (response.status === 204 || response.status === 205) {
    await response.body?.cancel().catch(() => {});
    return undefined as T;
  }
  const bytes = await readBoundedBytes(response, responseLimit(serviceId));
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch (cause) {
    throw new Error(`${serviceId} API returned invalid JSON`, { cause });
  }
}

export class OAuthApiRequestError extends Error {
  override readonly name = "OAuthApiRequestError";

  constructor(readonly serviceId: OAuthClientService, readonly status: number) {
    super(`${serviceId} API request failed with status ${status}`);
  }
}

function resolveSameOriginEndpoint(
  serviceId: OAuthClientService,
  endpoint: string,
): string {
  const allowed = new URL(OAUTH_SERVICE_CONFIGS[serviceId].apiBaseUrl);
  let target: URL;
  try {
    target = new URL(endpoint);
  } catch {
    const base = new URL(allowed);
    if (!base.pathname.endsWith("/")) base.pathname += "/";
    target = new URL(
      endpoint.startsWith("/") ? endpoint.slice(1) : endpoint,
      base,
    );
  }
  if (target.origin !== allowed.origin) {
    throw new TypeError(
      `OAuth endpoint origin ${target.origin} does not match ${allowed.origin}`,
    );
  }
  if (target.username || target.password || target.hash) {
    throw new TypeError(
      "OAuth endpoint must not contain credentials or a fragment",
    );
  }
  return target.toString();
}

function requestSignal(
  serviceId: OAuthClientService,
  signal?: AbortSignal | null,
): AbortSignal {
  const timeout = AbortSignal.timeout(
    OAUTH_SERVICE_CONFIGS[serviceId].requestTimeoutMs ??
      DEFAULT_REQUEST_TIMEOUT_MS,
  );
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function fetchOAuthResponse(
  userId: string,
  serviceId: OAuthClientService,
  endpoint: string,
  options: RequestInit,
): Promise<Response> {
  const token = await getOAuthService(serviceId).getAccessToken(userId);
  if (!token) throw new Error(`Not authenticated with ${serviceId}`);

  const headers = new Headers(OAUTH_SERVICE_CONFIGS[serviceId].apiHeaders);
  for (const [name, value] of new Headers(options.headers)) {
    headers.set(name, value);
  }
  headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(resolveSameOriginEndpoint(serviceId, endpoint), {
    ...options,
    headers,
    signal: requestSignal(serviceId, options.signal),
    redirect: "error",
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new OAuthApiRequestError(serviceId, response.status);
  }
  return response;
}

async function readBoundedBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    await response.body?.cancel().catch(() => {});
    throw new TypeError("Response byte limit must be a positive safe integer");
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsedLength) || parsedLength < 0 ||
      parsedLength > maxBytes
    ) {
      await response.body?.cancel().catch(() => {});
      throw new RangeError(`Response exceeded ${maxBytes} bytes`);
    }
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RangeError(`Response exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function responseLimit(
  serviceId: OAuthClientService,
  override?: number,
): number {
  return override ??
    OAUTH_SERVICE_CONFIGS[serviceId].maxApiResponseBytes ??
    DEFAULT_RESPONSE_LIMIT_BYTES;
}

/** Execute a bounded same-origin OAuth request whose successful response is text. */
export async function fetchOAuthText(
  userId: string,
  serviceId: OAuthClientService,
  endpoint: string,
  options: RequestInit = {},
  maxResponseBytes?: number,
): Promise<string> {
  const response = await fetchOAuthResponse(
    userId,
    serviceId,
    endpoint,
    options,
  );
  return new TextDecoder().decode(
    await readBoundedBytes(
      response,
      responseLimit(serviceId, maxResponseBytes),
    ),
  );
}

/** Execute a bounded same-origin OAuth request whose successful response is binary. */
export async function fetchOAuthBytes(
  userId: string,
  serviceId: OAuthClientService,
  endpoint: string,
  options: RequestInit = {},
  maxResponseBytes?: number,
): Promise<Uint8Array> {
  const response = await fetchOAuthResponse(
    userId,
    serviceId,
    endpoint,
    options,
  );
  return await readBoundedBytes(
    response,
    responseLimit(serviceId, maxResponseBytes),
  );
}

/** Execute a same-origin OAuth request that must not return a response body. */
export async function fetchOAuthVoid(
  userId: string,
  serviceId: OAuthClientService,
  endpoint: string,
  options: RequestInit = {},
): Promise<void> {
  const response = await fetchOAuthResponse(
    userId,
    serviceId,
    endpoint,
    options,
  );
  if (response.body) {
    const bytes = await readBoundedBytes(response, 1024);
    if (bytes.byteLength !== 0) {
      throw new Error(`${serviceId} API returned an unexpected response body`);
    }
  }
}

function resolveCredentialFreeExternalUrl(endpoint: string): string {
  if (
    typeof endpoint !== "string" || endpoint.length === 0 ||
    endpoint.length > MAX_EXTERNAL_URL_LENGTH
  ) {
    throw new TypeError("External endpoint must be a bounded non-empty URL");
  }
  const target = new URL(endpoint);
  if (
    target.protocol !== "https:" || target.username || target.password ||
    target.hash
  ) {
    throw new TypeError(
      "External endpoint must be credential-free HTTPS without a fragment",
    );
  }
  return target.toString();
}

function assertCredentialFreeHeaders(headers: Headers): void {
  for (const name of ["authorization", "cookie", "proxy-authorization"]) {
    if (headers.has(name)) {
      throw new TypeError(`Credential-free request cannot include ${name}`);
    }
  }
}

async function fetchExternalResponse(
  endpoint: string,
  options: RequestInit,
): Promise<Response> {
  const headers = new Headers(options.headers);
  assertCredentialFreeHeaders(headers);
  const timeout = AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  const response = await fetch(resolveCredentialFreeExternalUrl(endpoint), {
    ...options,
    credentials: "omit",
    headers,
    redirect: "error",
    signal,
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`External request failed with status ${response.status}`);
  }
  return response;
}

/** Download bounded bytes from a provider-issued URL without forwarding OAuth credentials. */
export async function fetchExternalBytes(
  endpoint: string,
  options: RequestInit = {},
  maxResponseBytes = DEFAULT_RESPONSE_LIMIT_BYTES,
): Promise<Uint8Array> {
  return await readBoundedBytes(
    await fetchExternalResponse(endpoint, options),
    maxResponseBytes,
  );
}

/** Call a provider-issued URL without forwarding OAuth credentials and parse bounded JSON. */
export async function fetchExternalJson<T>(
  endpoint: string,
  options: RequestInit = {},
  maxResponseBytes = DEFAULT_RESPONSE_LIMIT_BYTES,
): Promise<T> {
  const bytes = await readBoundedBytes(
    await fetchExternalResponse(endpoint, options),
    maxResponseBytes,
  );
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch (cause) {
    throw new Error("External endpoint returned invalid JSON", { cause });
  }
}
