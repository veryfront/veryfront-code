// In-memory token store for development
// For production, replace with a database-backed implementation

interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  userId: string;
}

let tokenStore: TokenData | null = null;

export function setTokens(data: TokenData): void {
  tokenStore = data;
}

export function getAccessToken(): string | null {
  return tokenStore?.accessToken || null;
}

export function getRefreshToken(): string | null {
  return tokenStore?.refreshToken || null;
}

export function getUserId(): string | null {
  return tokenStore?.userId || null;
}

export function clearTokens(): void {
  tokenStore = null;
}

export function isAuthenticated(): boolean {
  return tokenStore !== null;
}
