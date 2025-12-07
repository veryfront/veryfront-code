// Atlassian OAuth 2.0 utilities for Jira

const ATLASSIAN_AUTH_URL = "https://auth.atlassian.com/authorize";
const ATLASSIAN_TOKEN_URL = "https://auth.atlassian.com/oauth/token";
const ATLASSIAN_RESOURCES_URL = "https://api.atlassian.com/oauth/token/accessible-resources";

export function getAuthorizationUrl(redirectUri: string, state?: string): string {
  const clientId = process.env.ATLASSIAN_CLIENT_ID;
  if (!clientId) {
    throw new Error("ATLASSIAN_CLIENT_ID environment variable is not set");
  }

  const params = new URLSearchParams({
    audience: "api.atlassian.com",
    client_id: clientId,
    scope: "read:jira-work write:jira-work read:jira-user offline_access",
    redirect_uri: redirectUri,
    response_type: "code",
    prompt: "consent",
  });

  if (state) {
    params.set("state", state);
  }

  return `${ATLASSIAN_AUTH_URL}?${params.toString()}`;
}

export interface AtlassianTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
}

export interface AtlassianResource {
  id: string;
  name: string;
  url: string;
  scopes: string[];
  avatarUrl: string;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<AtlassianTokenResponse> {
  const clientId = process.env.ATLASSIAN_CLIENT_ID;
  const clientSecret = process.env.ATLASSIAN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("ATLASSIAN_CLIENT_ID and ATLASSIAN_CLIENT_SECRET must be set");
  }

  const response = await fetch(ATLASSIAN_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Token exchange failed: ${error.error_description || error.error || response.statusText}`,
    );
  }

  return response.json();
}

export async function getAccessibleResources(accessToken: string): Promise<AtlassianResource[]> {
  const response = await fetch(ATLASSIAN_RESOURCES_URL, {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Failed to get accessible resources: ${error.message || response.statusText}`);
  }

  return response.json();
}
