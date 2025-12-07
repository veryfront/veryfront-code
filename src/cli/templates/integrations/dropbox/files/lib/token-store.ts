// In-memory token store for development
// For production, replace with a database-backed implementation

interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  accountId?: string;
  tokenType: string;
}

let tokenStore: TokenData | null = null;

export function setTokens(data: TokenData): void {
  tokenStore = data;
}

export async function getAccessToken(): Promise<string | null> {
  if (!tokenStore) return null;

  // Check if token is expired and needs refresh
  if (tokenStore.expiresAt && Date.now() >= tokenStore.expiresAt) {
    if (tokenStore.refreshToken) {
      try {
        await refreshAccessToken();
      } catch (error) {
        console.error("Failed to refresh access token:", error);
        return null;
      }
    } else {
      return null;
    }
  }

  return tokenStore.accessToken;
}

export function getRefreshToken(): string | null {
  return tokenStore?.refreshToken || null;
}

export async function refreshAccessToken(): Promise<void> {
  if (!tokenStore?.refreshToken) {
    throw new Error("No refresh token available");
  }

  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;

  if (!appKey || !appSecret) {
    throw new Error("DROPBOX_APP_KEY and DROPBOX_APP_SECRET must be set");
  }

  const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokenStore.refreshToken,
      client_id: appKey,
      client_secret: appSecret,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Token refresh failed: ${error.error || response.statusText}`);
  }

  const data = await response.json();

  // Update stored tokens
  tokenStore.accessToken = data.access_token;
  tokenStore.expiresAt = Date.now() + (data.expires_in * 1000);
  tokenStore.tokenType = data.token_type;
}

export function getAccountId(): string | null {
  return tokenStore?.accountId || null;
}

export function clearTokens(): void {
  tokenStore = null;
}

export function isAuthenticated(): boolean {
  return tokenStore !== null;
}
