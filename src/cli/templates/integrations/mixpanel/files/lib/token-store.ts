// In-memory token store for development
// For production, replace with a secure database-backed implementation

let projectToken: string | null = null;
let apiSecret: string | null = null;
let projectId: string | null = null;

export function setProjectToken(token: string): void {
  projectToken = token;
}

export function getProjectToken(): string | null {
  // Try environment variable first, then in-memory store
  return process.env.MIXPANEL_PROJECT_TOKEN || projectToken;
}

export function setApiSecret(secret: string): void {
  apiSecret = secret;
}

export function getApiSecret(): string | null {
  // Try environment variable first, then in-memory store
  return process.env.MIXPANEL_API_SECRET || apiSecret;
}

export function setProjectId(id: string): void {
  projectId = id;
}

export function getProjectId(): string | null {
  // Try environment variable first, then in-memory store
  return process.env.MIXPANEL_PROJECT_ID || projectId;
}

export function clearTokens(): void {
  projectToken = null;
  apiSecret = null;
  projectId = null;
}

export function isAuthenticated(): boolean {
  return getProjectToken() !== null && getApiSecret() !== null && getProjectId() !== null;
}
