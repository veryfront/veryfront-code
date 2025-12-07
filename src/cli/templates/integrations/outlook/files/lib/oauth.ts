// Microsoft OAuth utilities

const MICROSOFT_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

const SCOPES = [
  "Mail.Read",
  "Mail.Send",
  "Mail.ReadWrite",
  "offline_access",
];

export function getAuthorizationUrl(redirectUri: string, state?: string): string {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!clientId) {
    throw new Error("MICROSOFT_CLIENT_ID environment variable is not set");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: SCOPES.join(" "),
  });

  if (state) {
    params.set("state", state);
  }

  return `${MICROSOFT_AUTH_URL}?${params.toString()}`;
}

export interface MicrosoftTokenResponse {
  token_type: "Bearer";
  scope: string;
  expires_in: number;
  access_token: string;
  refresh_token?: string;
  id_token?: string;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<MicrosoftTokenResponse> {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must be set");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    scope: SCOPES.join(" "),
  });

  const response = await fetch(MICROSOFT_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Token exchange failed: ${error.error_description || error.error || response.statusText}`,
    );
  }

  return response.json();
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<MicrosoftTokenResponse> {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must be set");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    scope: SCOPES.join(" "),
  });

  const response = await fetch(MICROSOFT_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `Token refresh failed: ${error.error_description || error.error || response.statusText}`,
    );
  }

  return response.json();
}
