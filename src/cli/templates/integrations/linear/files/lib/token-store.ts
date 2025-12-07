// In-memory token store for development
// For production, replace with a database-backed implementation

interface TokenData {
  accessToken: string;
  expiresAt: number;
  scope: string;
}

let tokenStore: TokenData | null = null;

export function setTokens(data: TokenData): void {
  tokenStore = data;
}

export function getAccessToken(): string | null {
  if (!tokenStore) return null;

  // Check if token is expired
  if (Date.now() >= tokenStore.expiresAt) {
    tokenStore = null;
    return null;
  }

  return tokenStore.accessToken;
}

export function clearTokens(): void {
  tokenStore = null;
}

export function isAuthenticated(): boolean {
  const token = getAccessToken();
  return token !== null;
}
