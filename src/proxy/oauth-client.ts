/**
 * OAuth Client for Veryfront API - client credentials flow.
 */

import { injectContext, ProxySpanNames, withSpan } from "./tracing.ts";
import { TIMEOUT_ERROR } from "#veryfront/errors";
import {
  ProxyResponseBodyError,
  readProxyResponseJson,
  readProxyResponseText,
  settleProxyResponseBody,
} from "./response-body.ts";
import { sanitizeUrlCredentials, sanitizeUrlForSpan } from "#veryfront/utils/logger/redact.ts";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_TOKEN_RESPONSE_BYTES = 128 * 1024;
const MAX_ERROR_RESPONSE_BYTES = 16 * 1024;
const MAX_ACCESS_TOKEN_LENGTH = 64 * 1024;
const MAX_TOKEN_LIFETIME_SECONDS = 365 * 24 * 60 * 60;

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in?: number;
}

export class OAuthTokenRequestError extends Error {
  constructor(
    readonly status: number,
    readonly responseText: string,
  ) {
    super(`OAuth token request failed: ${status} - ${responseText}`);
    this.name = "OAuthTokenRequestError";
  }
}

interface OAuthTokenConfig {
  apiBaseUrl: string;
  apiClientId: string;
  apiClientSecret: string;
  projectSlug?: string;
  customDomain?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function resolveOAuthUrl(apiBaseUrl: string): URL {
  const base = new URL(apiBaseUrl);
  if (
    (base.protocol !== "http:" && base.protocol !== "https:") ||
    base.username ||
    base.password
  ) {
    throw new TypeError("OAuth API base URL must be an HTTP(S) URL without credentials");
  }
  base.search = "";
  base.hash = "";
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  return new URL("auth/token", base);
}

function resolveTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw new RangeError(`OAuth timeout must be an integer between 1 and ${MAX_TIMEOUT_MS}ms`);
  }
  return value;
}

function parseTokenResponse(value: unknown): TokenResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("OAuth API returned an invalid token response");
  }
  const response = value as Record<string, unknown>;
  const accessToken = response.access_token;
  const tokenType = response.token_type;
  const expiresIn = response.expires_in;
  if (
    typeof accessToken !== "string" ||
    accessToken.length === 0 ||
    accessToken.length > MAX_ACCESS_TOKEN_LENGTH ||
    /[^\u0021-\u007e]/u.test(accessToken) ||
    typeof tokenType !== "string" ||
    tokenType.toLowerCase() !== "bearer" ||
    (expiresIn !== undefined &&
      (typeof expiresIn !== "number" ||
        !Number.isSafeInteger(expiresIn) ||
        expiresIn <= 0 ||
        expiresIn > MAX_TOKEN_LIFETIME_SECONDS))
  ) {
    throw new TypeError("OAuth API returned an invalid token response");
  }
  return {
    access_token: accessToken,
    token_type: "Bearer",
    ...(expiresIn === undefined ? {} : { expires_in: expiresIn }),
  };
}

async function readOAuthErrorText(
  response: Response,
  signal: AbortSignal,
): Promise<string> {
  try {
    return sanitizeUrlCredentials(
      await readProxyResponseText(response, MAX_ERROR_RESPONSE_BYTES, signal),
    );
  } catch (error) {
    if (signal.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException("OAuth token response read was aborted", "AbortError");
    }
    if (error instanceof ProxyResponseBodyError && error.failure === "too-large") {
      return "OAuth error response exceeded the supported size";
    }
    return "OAuth error response was unreadable";
  }
}

export async function fetchOAuthToken(
  config: OAuthTokenConfig,
): Promise<TokenResponse> {
  return withSpan(
    ProxySpanNames.OAUTH_TOKEN_REQUEST,
    async (): Promise<TokenResponse> => {
      const urlObj = resolveOAuthUrl(config.apiBaseUrl);
      const url = urlObj.toString();

      const controller = new AbortController();
      const timeoutMs = resolveTimeoutMs(config.timeoutMs);
      const timeoutId = setTimeout((): void => controller.abort(), timeoutMs);
      let abortedByCaller = false;
      const abortFromCaller = (): void => {
        abortedByCaller = true;
        controller.abort(config.signal?.reason);
      };
      if (config.signal?.aborted) abortFromCaller();
      else config.signal?.addEventListener("abort", abortFromCaller, { once: true });

      try {
        const headers = new Headers({ "Content-Type": "application/json" });
        injectContext(headers);

        const body = {
          grant_type: "client_credentials",
          client_id: config.apiClientId,
          client_secret: config.apiClientSecret,
          ...(config.projectSlug ? { project_slug: config.projectSlug } : {}),
          ...(config.customDomain ? { custom_domain: config.customDomain } : {}),
        };

        const response = await withSpan(
          ProxySpanNames.HTTP_CLIENT_FETCH,
          (): Promise<Response> =>
            fetch(url, {
              method: "POST",
              headers,
              body: JSON.stringify(body),
              signal: controller.signal,
            }),
          {
            "http.method": "POST",
            "http.url": sanitizeUrlForSpan(url),
            "http.host": urlObj.host,
            "oauth.grant_type": "client_credentials",
          },
        );

        if (response.ok) {
          const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
          if (contentType !== "application/json") {
            await settleProxyResponseBody(response);
            throw new TypeError("OAuth API returned an invalid token response");
          }
          return parseTokenResponse(
            await readProxyResponseJson(
              response,
              MAX_TOKEN_RESPONSE_BYTES,
              controller.signal,
            ),
          );
        }

        const errorText = await readOAuthErrorText(response, controller.signal);
        throw new OAuthTokenRequestError(response.status, errorText);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          if (abortedByCaller) {
            const reason = config.signal?.reason;
            if (reason instanceof Error) throw reason;
            throw new DOMException("OAuth token request was aborted", "AbortError");
          }
          throw TIMEOUT_ERROR.create({
            detail: `OAuth token request timed out after ${timeoutMs}ms`,
          });
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
        config.signal?.removeEventListener("abort", abortFromCaller);
      }
    },
    {
      "oauth.project_slug": config.projectSlug ?? "",
      "oauth.custom_domain": config.customDomain ?? "",
    },
  );
}
