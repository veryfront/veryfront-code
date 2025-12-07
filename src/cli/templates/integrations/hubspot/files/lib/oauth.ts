// HubSpot OAuth utilities

const HUBSPOT_AUTH_URL = "https://app.hubspot.com/oauth/authorize";
const HUBSPOT_TOKEN_URL = "https://api.hubapi.com/oauth/v1/token";

export function getAuthorizationUrl(redirectUri: string, state?: string): string {
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  if (!clientId) {
    throw new Error("HUBSPOT_CLIENT_ID environment variable is not set");
  }

  const scopes = [
    "crm.objects.contacts.read",
    "crm.objects.contacts.write",
    "crm.objects.companies.read",
    "crm.objects.deals.read",
  ];

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(" "),
  });

  if (state) {
    params.set("state", state);
  }

  return `${HUBSPOT_AUTH_URL}?${params.toString()}`;
}

export interface HubSpotTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: "bearer";
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<HubSpotTokenResponse> {
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET must be set");
  }

  const params = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });

  const response = await fetch(HUBSPOT_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Token exchange failed: ${error.message || response.statusText}`);
  }

  return response.json();
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<HubSpotTokenResponse> {
  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET must be set");
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  const response = await fetch(HUBSPOT_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Token refresh failed: ${error.message || response.statusText}`);
  }

  return response.json();
}
