/**
 * ServiceNow Token Store
 *
 * Simple in-memory token storage for development.
 * In production, use a persistent store like Redis or a database.
 */

export interface ServiceNowTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  instanceUrl?: string;
}

// In-memory storage (replace with persistent storage in production)
let tokens: ServiceNowTokens | null = null;

export function getServiceNowTokens(): Promise<ServiceNowTokens | null> {
  return Promise.resolve(tokens);
}

export function setServiceNowTokens(newTokens: ServiceNowTokens): Promise<void> {
  tokens = newTokens;
  return Promise.resolve();
}

export function clearServiceNowTokens(): Promise<void> {
  tokens = null;
  return Promise.resolve();
}

export async function isServiceNowConnected(): Promise<boolean> {
  const t = await getServiceNowTokens();
  if (!t) return false;

  // Check if token is expired (with 5 minute buffer)
  if (t.expiresAt && Date.now() > t.expiresAt - 5 * 60 * 1000) {
    return false;
  }

  return true;
}
