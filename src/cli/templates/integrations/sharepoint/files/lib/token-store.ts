// In-memory token store for development
// For production, replace with a database-backed implementation

interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType: string;
  scope?: string;
}

let tokenStore: TokenData | null = null;

export function setTokens(data: TokenData): void {
  tokenStore = data;
}

export function getAccessToken(): string | null {
  if (!tokenStore) return null;

  // Check if token is expired
  if (tokenStore.expiresAt && Date.now() >= tokenStore.expiresAt) {
    // Token expired - should refresh (not implemented in this simple store)
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
  const token = getAccessToken();
  return token !== null;
}
