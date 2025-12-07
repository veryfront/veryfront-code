// GitLab OAuth utilities

const GITLAB_AUTH_URL = "https://gitlab.com/oauth/authorize";
const GITLAB_TOKEN_URL = "https://gitlab.com/oauth/token";

export function getAuthorizationUrl(redirectUri: string, state?: string): string {
  const clientId = process.env.GITLAB_CLIENT_ID;
  if (!clientId) {
    throw new Error("GITLAB_CLIENT_ID environment variable is not set");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "api read_user read_repository",
  });

  if (state) {
    params.set("state", state);
  }

  return `${GITLAB_AUTH_URL}?${params.toString()}`;
}

export interface GitLabTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in?: number;
  refresh_token?: string;
  scope: string;
  created_at: number;
}

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<GitLabTokenResponse> {
  const clientId = process.env.GITLAB_CLIENT_ID;
  const clientSecret = process.env.GITLAB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("GITLAB_CLIENT_ID and GITLAB_CLIENT_SECRET must be set");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });

  const response = await fetch(GITLAB_TOKEN_URL, {
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

export async function refreshAccessToken(refreshToken: string): Promise<GitLabTokenResponse> {
  const clientId = process.env.GITLAB_CLIENT_ID;
  const clientSecret = process.env.GITLAB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("GITLAB_CLIENT_ID and GITLAB_CLIENT_SECRET must be set");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch(GITLAB_TOKEN_URL, {
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
