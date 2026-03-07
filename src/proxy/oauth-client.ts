/**
 * OAuth Client for Veryfront API - client credentials flow.
 */

import { injectContext, ProxySpanNames, withSpan } from "./tracing.ts";

const DEFAULT_TIMEOUT_MS = 10_000;

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in?: number;
}

export interface OAuthTokenConfig {
  apiBaseUrl: string;
  apiClientId: string;
  apiClientSecret: string;
  projectSlug?: string;
  customDomain?: string;
  timeoutMs?: number;
}

export async function fetchOAuthToken(
  config: OAuthTokenConfig,
): Promise<TokenResponse> {
  return withSpan(
    ProxySpanNames.OAUTH_TOKEN_REQUEST,
    async (): Promise<TokenResponse> => {
      const url = `${config.apiBaseUrl}/auth/token`;
      const urlObj = new URL(url);

      const controller = new AbortController();
      const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const timeoutId = setTimeout((): void => controller.abort(), timeoutMs);

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
            "http.url": url,
            "http.host": urlObj.host,
            "oauth.grant_type": "client_credentials",
          },
        );

        if (response.ok) {
          return response.json();
        }

        const errorText = await response.text().catch((): string => "Unknown error");
        throw new Error(
          `OAuth token request failed: ${response.status} - ${errorText}`,
        );
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new Error(`OAuth token request timed out after ${timeoutMs}ms`);
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    },
    {
      "oauth.project_slug": config.projectSlug ?? "",
      "oauth.custom_domain": config.customDomain ?? "",
    },
  );
}
