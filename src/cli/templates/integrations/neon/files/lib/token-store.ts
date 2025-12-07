// In-memory token store for development
// For production, replace with a database-backed implementation

interface TokenData {
  apiKey: string;
  databaseUrl?: string;
}

let tokenStore: TokenData | null = null;

export function setApiKey(apiKey: string, databaseUrl?: string): void {
  tokenStore = { apiKey, databaseUrl };
}

export function getApiKey(): string | null {
  return tokenStore?.apiKey || null;
}

export function getDatabaseUrl(): string | null {
  return tokenStore?.databaseUrl || process.env.DATABASE_URL || null;
}

export function clearTokens(): void {
  tokenStore = null;
}

export function isAuthenticated(): boolean {
  return tokenStore !== null && tokenStore.apiKey !== null;
}
