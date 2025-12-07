// In-memory token store for development
// For production, replace with a database-backed implementation

interface TokenData {
  accessToken: string;
  workspaceId: string;
  workspaceName?: string;
  botId: string;
  expiresAt?: number;
}

let tokenStore: TokenData | null = null;

export function setTokens(data: TokenData): void {
  tokenStore = data;
}

export function getAccessToken(): string | null {
  return tokenStore?.accessToken || null;
}

export function getWorkspaceInfo(): { id: string; name?: string } | null {
  if (!tokenStore) return null;
  return {
    id: tokenStore.workspaceId,
    name: tokenStore.workspaceName,
  };
}

export function clearTokens(): void {
  tokenStore = null;
}

export function isAuthenticated(): boolean {
  return tokenStore !== null;
}
