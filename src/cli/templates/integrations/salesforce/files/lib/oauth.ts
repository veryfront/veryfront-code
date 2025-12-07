// Salesforce OAuth utilities

const SALESFORCE_AUTH_URL = "https://login.salesforce.com/services/oauth2/authorize";
const SALESFORCE_TOKEN_URL = "https://login.salesforce.com/services/oauth2/token";

export function getAuthorizationUrl(redirectUri: string, state?: string): string {
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  if (!clientId) {
    throw new Error("SALESFORCE_CLIENT_ID environment variable is not set");
  }

  const scopes = ["api", "refresh_token", "offline_access"];

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(" "),
  });

  if (state) {
    params.set("state", state);
  }

  return `${SALESFORCE_AUTH_URL}?${params.toString()}`;
}

export interface SalesforceTokenResponse {
  access_token: string;
  refresh_token: string;
  instance_url: string;
  id: string;
  token_type: "Bearer";
  issued_at: string;
  signature: string;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<SalesforceTokenResponse> {
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET must be set");
  }

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });

  const response = await fetch(SALESFORCE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Token exchange failed: ${error.error_description || error.message || response.statusText}`,
    );
  }

  return response.json();
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<SalesforceTokenResponse> {
  const clientId = process.env.SALESFORCE_CLIENT_ID;
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("SALESFORCE_CLIENT_ID and SALESFORCE_CLIENT_SECRET must be set");
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const response = await fetch(SALESFORCE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Token refresh failed: ${error.error_description || error.message || response.statusText}`,
    );
  }

  return response.json();
}

// Parse user and org IDs from the id URL
export function parseIdentity(idUrl: string): { userId: string; orgId: string } | null {
  try {
    // Salesforce id URL format: https://login.salesforce.com/id/{orgId}/{userId}
    const parts = idUrl.split("/");
    const userId = parts[parts.length - 1];
    const orgId = parts[parts.length - 2];
    return { userId, orgId };
  } catch {
    return null;
  }
}
