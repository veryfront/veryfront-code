/**
 * OAuth Client for Veryfront API - client credentials flow.
 */

import { injectContext, ProxySpanNames, withSpan } from "./tracing.ts";
import { TIMEOUT_ERROR } from "#veryfront/errors";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_BASE_URL_LENGTH = 4_096;
const MAX_CREDENTIAL_LENGTH = 65_536;
const MAX_IDENTITY_LENGTH = 1_024;
const MAX_ACCESS_TOKEN_LENGTH = 65_536;
const MAX_TOKEN_RESPONSE_BYTES = 128 * 1_024;
const MAX_ERROR_RESPONSE_BYTES = 8 * 1_024;
const MAX_EMPTY_RESPONSE_CHUNKS = 100;

/** Stable classifications derived from allowlisted OAuth error payloads. */
export type OAuthTokenErrorReason = "project-not-found-for-domain";

/** Successful response returned by the Veryfront token endpoint. */
export interface TokenResponse {
  /** Access token. */
  access_token: string;
  /** Supported authorization scheme. */
  token_type: "Bearer";
  /** Token lifetime in seconds. */
  expires_in?: number;
}

/** HTTP failure returned by the Veryfront token endpoint. */
export class OAuthTokenRequestError extends Error {
  /** HTTP response status. */
  readonly status: number;
  /** Sanitized compatibility summary that never contains the response body. */
  readonly responseText: string;
  /** Optional allowlisted machine-readable failure classification. */
  readonly reason?: OAuthTokenErrorReason;

  /** Create a sanitized HTTP token failure. */
  constructor(
    status: number,
    _responseText = `HTTP ${status}`,
    reason?: OAuthTokenErrorReason,
  ) {
    if (!Number.isSafeInteger(status) || status < 100 || status > 599) {
      throw new RangeError("OAuth token response status must be a valid HTTP status");
    }
    super(`OAuth token request failed with status ${status}`);
    this.name = "OAuthTokenRequestError";
    this.status = status;
    // Preserve the established property without retaining or surfacing an
    // upstream response body, which can contain credentials or customer data.
    this.responseText = `HTTP ${status}`;
    if (reason !== undefined) this.reason = reason;
  }
}

/** Network failure that does not expose the configured endpoint or transport details. */
export class OAuthTokenNetworkError extends Error {
  /** Create a network failure without endpoint details. */
  constructor() {
    super("OAuth token request could not be completed");
    this.name = "OAuthTokenNetworkError";
  }
}

/** Configuration for a Veryfront client-credentials token request. */
export interface OAuthTokenConfig {
  /** Veryfront API base URL. */
  apiBaseUrl: string;
  /** OAuth client identifier. */
  apiClientId: string;
  /** OAuth client secret. */
  apiClientSecret: string;
  /** Project-scoped token identity. */
  projectSlug?: string;
  /** Custom-domain token identity. */
  customDomain?: string;
  /** Whole-response timeout in milliseconds. */
  timeoutMs?: number;
}

function requireBoundedText(name: string, value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${name} must be a non-empty string of at most ${maximum} characters`);
  }
  return value;
}

function optionalBoundedText(name: string, value: unknown, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  return requireBoundedText(name, value, maximum);
}

function tokenEndpoint(config: OAuthTokenConfig): URL {
  const rawBaseUrl = requireBoundedText("apiBaseUrl", config.apiBaseUrl, MAX_BASE_URL_LENGTH);
  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new TypeError("apiBaseUrl must be a valid absolute HTTP or HTTPS URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("apiBaseUrl must use HTTP or HTTPS");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError("apiBaseUrl must not contain credentials, a query, or a fragment");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/auth/token`;
  return url;
}

function requestTimeout(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new RangeError(`timeoutMs must be an integer between 1 and ${MAX_TIMEOUT_MS}`);
  }
  return timeoutMs;
}

function cancelResponseBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => {});
  } catch {
    // Releasing a response body is best effort and must not mask the HTTP error.
  }
}

async function readBoundedOAuthResponse(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    cancelResponseBody(response);
    throw new TypeError("Invalid OAuth token response: body exceeds the size limit");
  }

  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let emptyChunks = 0;
  let complete = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      if (value.byteLength === 0) {
        emptyChunks++;
        if (emptyChunks >= MAX_EMPTY_RESPONSE_CHUNKS) {
          throw new TypeError("Invalid OAuth token response: body made no progress");
        }
        continue;
      }
      emptyChunks = 0;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        throw new TypeError("Invalid OAuth token response: body exceeds the size limit");
      }
      chunks.push(value);
    }
  } finally {
    if (!complete) {
      try {
        void reader.cancel().catch(() => {});
      } catch {
        // Cancellation is best effort and must not mask the protocol error.
      }
    }
    try {
      reader.releaseLock();
    } catch {
      // A non-conforming stream must not mask the protocol error.
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function errorReasonFromText(text: string): OAuthTokenErrorReason | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const candidate = typeof record.code === "string"
    ? record.code
    : typeof record.error === "string"
    ? record.error
    : undefined;
  if (!candidate || candidate.length > 128) return undefined;
  const normalized = candidate.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return normalized === "project-not-found-for-domain" ? "project-not-found-for-domain" : undefined;
}

async function readOAuthErrorReason(
  response: Response,
): Promise<OAuthTokenErrorReason | undefined> {
  try {
    return errorReasonFromText(await readBoundedOAuthResponse(response, MAX_ERROR_RESPONSE_BYTES));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    return undefined;
  }
}

function parseTokenResponse(text: string): TokenResponse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new TypeError("Invalid OAuth token response: expected JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Invalid OAuth token response: expected an object");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.access_token !== "string" || record.access_token.length === 0 ||
    record.access_token.length > MAX_ACCESS_TOKEN_LENGTH || /\s/u.test(record.access_token) ||
    record.token_type !== "Bearer"
  ) {
    throw new TypeError("Invalid OAuth token response: invalid access token or token type");
  }
  if (
    record.expires_in !== undefined &&
    (!Number.isSafeInteger(record.expires_in) || (record.expires_in as number) <= 0)
  ) {
    throw new TypeError("Invalid OAuth token response: expires_in must be a positive integer");
  }
  return {
    access_token: record.access_token,
    token_type: "Bearer",
    ...(record.expires_in === undefined ? {} : { expires_in: record.expires_in as number }),
  };
}

/** Fetch a bounded, validated client-credentials token response. */
export async function fetchOAuthToken(
  config: OAuthTokenConfig,
): Promise<TokenResponse> {
  if (typeof config !== "object" || config === null) {
    throw new TypeError("OAuth token config must be an object");
  }
  const urlObj = tokenEndpoint(config);
  const apiClientId = requireBoundedText(
    "apiClientId",
    config.apiClientId,
    MAX_CREDENTIAL_LENGTH,
  );
  const apiClientSecret = requireBoundedText(
    "apiClientSecret",
    config.apiClientSecret,
    MAX_CREDENTIAL_LENGTH,
  );
  const projectSlug = optionalBoundedText(
    "projectSlug",
    config.projectSlug,
    MAX_IDENTITY_LENGTH,
  );
  const customDomain = optionalBoundedText(
    "customDomain",
    config.customDomain,
    MAX_IDENTITY_LENGTH,
  );
  if (projectSlug !== undefined && customDomain !== undefined) {
    throw new TypeError("projectSlug and customDomain are mutually exclusive");
  }
  const timeoutMs = requestTimeout(config.timeoutMs);

  return withSpan(
    ProxySpanNames.OAUTH_TOKEN_REQUEST,
    async (): Promise<TokenResponse> => {
      const controller = new AbortController();
      let timedOut = false;
      const timeoutId = setTimeout((): void => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      try {
        const headers = new Headers({ "Content-Type": "application/json" });
        injectContext(headers);

        const body = {
          grant_type: "client_credentials",
          client_id: apiClientId,
          client_secret: apiClientSecret,
          ...(projectSlug === undefined ? {} : { project_slug: projectSlug }),
          ...(customDomain === undefined ? {} : { custom_domain: customDomain }),
        };

        const response = await withSpan(
          ProxySpanNames.HTTP_CLIENT_FETCH,
          async (): Promise<Response> => {
            try {
              return await fetch(urlObj, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
                redirect: "error",
                signal: controller.signal,
              });
            } catch (error) {
              if (error instanceof Error && error.name === "AbortError") throw error;
              throw new OAuthTokenNetworkError();
            }
          },
          {
            "http.method": "POST",
            "oauth.grant_type": "client_credentials",
          },
        );

        if (!response.ok) {
          const reason = await readOAuthErrorReason(response);
          throw new OAuthTokenRequestError(response.status, undefined, reason);
        }

        return parseTokenResponse(
          await readBoundedOAuthResponse(response, MAX_TOKEN_RESPONSE_BYTES),
        );
      } catch (error) {
        if (timedOut && error instanceof Error && error.name === "AbortError") {
          throw TIMEOUT_ERROR.create({
            detail: `OAuth token request timed out after ${timeoutMs}ms`,
          });
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    },
    {
      "oauth.has_project_slug": projectSlug !== undefined,
      "oauth.has_custom_domain": customDomain !== undefined,
    },
  );
}
