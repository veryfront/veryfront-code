// Figma OAuth utilities

const FIGMA_AUTH_URL = "https://www.figma.com/oauth";
const FIGMA_TOKEN_URL = "https://www.figma.com/api/oauth/token";

export function getAuthorizationUrl(redirectUri: string, state?: string): string {
  const clientId = process.env.FIGMA_CLIENT_ID;
  if (!clientId) {
    throw new Error("FIGMA_CLIENT_ID environment variable is not set");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "file_read",
  });

  if (state) {
    params.set("state", state);
  }

  return `${FIGMA_AUTH_URL}?${params.toString()}`;
}

export interface FigmaTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: "bearer";
  user_id: string;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<FigmaTokenResponse> {
  const clientId = process.env.FIGMA_CLIENT_ID;
  const clientSecret = process.env.FIGMA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("FIGMA_CLIENT_ID and FIGMA_CLIENT_SECRET must be set");
  }

  const response = await fetch(FIGMA_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Token exchange failed: ${error.error || response.statusText}`);
  }

  return response.json();
}

export async function refreshAccessToken(refreshToken: string): Promise<FigmaTokenResponse> {
  const clientId = process.env.FIGMA_CLIENT_ID;
  const clientSecret = process.env.FIGMA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("FIGMA_CLIENT_ID and FIGMA_CLIENT_SECRET must be set");
  }

  const response = await fetch(FIGMA_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Token refresh failed: ${error.error || response.statusText}`);
  }

  return response.json();
}
