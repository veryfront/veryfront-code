// In-memory token store for development
// For production, replace with a database-backed implementation

interface TokenData {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  instanceUrl: string;
  userId?: string;
  orgId?: string;
}

let tokenStore: TokenData | null = null;

export function setTokens(data: TokenData): void {
  tokenStore = data;
}

export function getAccessToken(): string | null {
  if (!tokenStore) return null;

  // Check if token is expired
  if (tokenStore.expiresAt && Date.now() >= tokenStore.expiresAt) {
    // Token expired - in production, you would refresh it here
    console.warn("Salesforce access token expired. Refresh token flow needed.");
    return null;
  }

  return tokenStore.accessToken;
}

export function getRefreshToken(): string | null {
  return tokenStore?.refreshToken || null;
}

export function getInstanceUrl(): string | null {
  return tokenStore?.instanceUrl || null;
}

export function getUserId(): string | null {
  return tokenStore?.userId || null;
}

export function getOrgId(): string | null {
  return tokenStore?.orgId || null;
}

export function clearTokens(): void {
  tokenStore = null;
}

export function isAuthenticated(): boolean {
  if (!tokenStore) return false;

  // Check if token is still valid
  if (tokenStore.expiresAt && Date.now() >= tokenStore.expiresAt) {
    return false;
  }

  return true;
}
