// In-memory API key store for development
// For production, replace with a secure database-backed implementation

let apiKey: string | null = null;

export function setApiKey(key: string): void {
  apiKey = key;
}

export function getApiKey(): string | null {
  // Try environment variable first, then in-memory store
  return process.env.STRIPE_SECRET_KEY || apiKey;
}

export function clearApiKey(): void {
  apiKey = null;
}

export function isAuthenticated(): boolean {
  return getApiKey() !== null;
}
