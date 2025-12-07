// In-memory token store for development
// For production, replace with a database-backed implementation

interface TokenData {
  authToken: string;
  org: string;
}

let tokenStore: TokenData | null = null;

export function setApiKey(authToken: string, org: string): void {
  tokenStore = { authToken, org };
}

export function getApiKey(): string | null {
  return tokenStore?.authToken || null;
}

export function getOrg(): string | null {
  return tokenStore?.org || process.env.SENTRY_ORG || null;
}

export function clearTokens(): void {
  tokenStore = null;
}

export function isAuthenticated(): boolean {
  return tokenStore !== null && tokenStore.authToken !== null;
}
