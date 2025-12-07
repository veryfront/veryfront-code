// In-memory token store for development
// For production, replace with a database-backed implementation

interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  userId?: string;
  userEmail?: string;
}

let tokenStore: TokenData | null = null;

export function setTokens(data: TokenData): void {
  tokenStore = data;
}

export function getAccessToken(): string | null {
  // Check if token is expired
  if (tokenStore?.expiresAt && Date.now() >= tokenStore.expiresAt) {
    // Token expired - in production, implement refresh logic here
    return null;
  }
  return tokenStore?.accessToken || null;
}

export function getRefreshToken(): string | null {
  return tokenStore?.refreshToken || null;
}

export function getUserInfo(): { id?: string; email?: string } | null {
  if (!tokenStore) return null;
  return {
    id: tokenStore.userId,
    email: tokenStore.userEmail,
  };
}

export function clearTokens(): void {
  tokenStore = null;
}

export function isAuthenticated(): boolean {
  const token = getAccessToken();
  return token !== null;
}
