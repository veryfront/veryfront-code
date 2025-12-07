// Dropbox OAuth utilities

const DROPBOX_AUTH_URL = "https://www.dropbox.com/oauth2/authorize";
const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";

export function getAuthorizationUrl(redirectUri: string, state?: string): string {
  const appKey = process.env.DROPBOX_APP_KEY;
  if (!appKey) {
    throw new Error("DROPBOX_APP_KEY environment variable is not set");
  }

  const params = new URLSearchParams({
    client_id: appKey,
    redirect_uri: redirectUri,
    response_type: "code",
    token_access_type: "offline", // Request refresh token
  });

  if (state) {
    params.set("state", state);
  }

  return `${DROPBOX_AUTH_URL}?${params.toString()}`;
}

export interface DropboxTokenResponse {
  access_token: string;
  token_type: "bearer";
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  uid?: string;
  account_id?: string;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<DropboxTokenResponse> {
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;

  if (!appKey || !appSecret) {
    throw new Error("DROPBOX_APP_KEY and DROPBOX_APP_SECRET must be set");
  }

  const response = await fetch(DROPBOX_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: appKey,
      client_secret: appSecret,
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

export async function revokeToken(token: string): Promise<void> {
  const response = await fetch("https://api.dropboxapi.com/2/auth/token/revoke", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Token revocation failed: ${error.error_summary || response.statusText}`);
  }
}
