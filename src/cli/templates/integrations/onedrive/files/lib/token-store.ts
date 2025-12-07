// In-memory token store for development
// For production, replace with a database-backed implementation

interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
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

  const { refreshAccessToken: refresh } = await import("./oauth.ts");
  const data = await refresh(tokenStore.refreshToken);

  // Update stored tokens
  tokenStore.accessToken = data.access_token;
  tokenStore.expiresAt = Date.now() + data.expires_in * 1000;
  tokenStore.tokenType = data.token_type;
  if (data.refresh_token) {
    tokenStore.refreshToken = data.refresh_token;
  }
}

export function clearTokens(): void {
  tokenStore = null;
}

export function isAuthenticated(): boolean {
  return tokenStore !== null;
}
