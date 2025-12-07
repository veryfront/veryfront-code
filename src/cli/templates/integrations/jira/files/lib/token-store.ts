// In-memory token store for development
// For production, replace with a database-backed implementation

interface TokenData {
  accessToken: string;
  refreshToken?: string;
  cloudId: string;
  siteName?: string;
  expiresAt?: number;
}

let tokenStore: TokenData | null = null;

export function setTokens(data: TokenData): void {
  tokenStore = data;
}

export function getAccessToken(): string | null {
  return tokenStore?.accessToken || null;
}

export function getCloudId(): string | null {
  return tokenStore?.cloudId || null;
}

export function getSiteInfo(): { cloudId: string; name?: string } | null {
  if (!tokenStore) return null;
  return {
    cloudId: tokenStore.cloudId,
    name: tokenStore.siteName,
  };
}

export function clearTokens(): void {
  tokenStore = null;
}

export function isAuthenticated(): boolean {
  return tokenStore !== null;
}
