// In-memory token store for development
// For production, replace with a database-backed implementation

interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}

let tokenStore: TokenData | null = null;

export function setTokens(data: TokenData): void {
  tokenStore = data;
}

export async function getAccessToken(): Promise<string | null> {
  if (!tokenStore) return null;

  // Check if token is expired
  const now = Date.now();
  if (tokenStore.expiresAt && tokenStore.expiresAt < now) {
    // Token is expired, need to refresh
    // For simplicity, return null and let the client handle re-authentication
    // In production, implement automatic token refresh here
    return null;
  }

  return tokenStore.accessToken;
}

export function getRefreshToken(): string | null {
  return tokenStore?.refreshToken || null;
}

export function clearTokens(): void {
  tokenStore = null;
}

export function isAuthenticated(): boolean {
  if (!tokenStore) return false;

  // Check if token is not expired
  const now = Date.now();
  return !tokenStore.expiresAt || tokenStore.expiresAt > now;
}

export function getTokenInfo(): TokenData | null {
  return tokenStore;
}
