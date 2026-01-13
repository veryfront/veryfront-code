/**
 * OAuth Client for Veryfront API - client credentials flow.
 */

import { injectContext } from "./tracing.ts";

const DEFAULT_TIMEOUT_MS = 10000;

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in?: number;
}

export interface OAuthTokenConfig {
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
  projectId?: string;
  timeoutMs?: number;
}

export async function fetchOAuthToken(
  config: OAuthTokenConfig,
): Promise<TokenResponse> {
  const url = `${config.apiBaseUrl}/oauth/token`;
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const headers = new Headers({ "Content-Type": "application/json" });
    injectContext(headers);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        ...(config.projectId && { projectId: config.projectId }),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      throw new Error(
        `OAuth token request failed: ${response.status} - ${errorText}`,
      );
    }

    return response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `OAuth token request timed out after ${
          config.timeoutMs ?? DEFAULT_TIMEOUT_MS
        }ms`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
