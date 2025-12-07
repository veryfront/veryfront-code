// In-memory token store for development
// For production, replace with a database-backed implementation

interface TokenData {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt?: number;
  scope: string;
  userId?: string;
}

let tokenStore: TokenData | null = null;

export function setTokens(data: TokenData): void {
  tokenStore = data;
}

export function getAccessToken(): string | null {
  return tokenStore?.accessToken || null;
}

export function getTokenData(): TokenData | null {
  return tokenStore;
}

export function clearTokens(): void {
  tokenStore = null;
}

export function isAuthenticated(): boolean {
  if (!tokenStore) return false;

  // Check if token is expired
  if (tokenStore.expiresAt && Date.now() >= tokenStore.expiresAt) {
    return false;
  }

  return true;
}
