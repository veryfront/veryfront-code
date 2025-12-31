/**
 * OAuth Client for Veryfront API
 *
 * Handles OAuth 2.0 client credentials flow to obtain access tokens.
 */

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
}

/**
 * Fetch an OAuth access token using client credentials grant.
 */
export async function fetchOAuthToken(config: OAuthTokenConfig): Promise<TokenResponse> {
  const url = `${config.apiBaseUrl}/oauth/token`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      ...(config.projectId && { projectId: config.projectId }),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`OAuth token request failed: ${response.status} - ${errorText}`);
  }

  return response.json();
}
