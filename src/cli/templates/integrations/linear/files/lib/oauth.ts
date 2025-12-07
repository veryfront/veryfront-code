// Linear OAuth utilities

const LINEAR_AUTH_URL = "https://linear.app/oauth/authorize";
const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";

export function getAuthorizationUrl(redirectUri: string, state?: string): string {
  const clientId = process.env.LINEAR_CLIENT_ID;
  if (!clientId) {
    throw new Error("LINEAR_CLIENT_ID environment variable is not set");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "read,write",
  });

  if (state) {
    params.set("state", state);
  }

  return `${LINEAR_AUTH_URL}?${params.toString()}`;
}

export interface LinearTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: string;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<LinearTokenResponse> {
  const clientId = process.env.LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET must be set");
  }

  const response = await fetch(LINEAR_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Token exchange failed: ${error.error || response.statusText}`);
  }

  return response.json();
}
