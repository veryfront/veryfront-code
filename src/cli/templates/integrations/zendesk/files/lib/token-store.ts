/**
 * Zendesk Token Store
 *
 * Simple in-memory token storage for development.
 * In production, use a persistent store like Redis or a database.
 */

export interface ZendeskTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  subdomain?: string;
}

// In-memory storage (replace with persistent storage in production)
let tokens: ZendeskTokens | null = null;

export function getZendeskTokens(): Promise<ZendeskTokens | null> {
  return Promise.resolve(tokens);
}

export function setZendeskTokens(newTokens: ZendeskTokens): Promise<void> {
  tokens = newTokens;
  return Promise.resolve();
}

export function clearZendeskTokens(): Promise<void> {
  tokens = null;
  return Promise.resolve();
}

export async function isZendeskConnected(): Promise<boolean> {
  const t = await getZendeskTokens();
  if (!t) return false;

  // Check if token is expired (with 5 minute buffer)
  if (t.expiresAt && Date.now() > t.expiresAt - 5 * 60 * 1000) {
    return false;
  }

  return true;
}

export async function getSubdomain(): Promise<string | null> {
  const t = await getZendeskTokens();
  return t?.subdomain || null;
}
