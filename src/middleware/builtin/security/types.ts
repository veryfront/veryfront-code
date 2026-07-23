export type CSPDirectives = Record<string, string>;

export interface SecurityHeadersOptions {
  contentSecurityPolicy?: string | CSPDirectives;
  xssProtection?: boolean;
  noSniff?: boolean;
  frameOptions?: "DENY" | "SAMEORIGIN" | string;
  hsts?: {
    maxAge: number;
    includeSubDomains?: boolean;
    preload?: boolean;
  };
  referrerPolicy?: string;
  permissionsPolicy?: string;
}

export interface CSPOptions {
  nonce?: string;
  merge?: string;
}

export interface CORSOptions {
  origin?: string;
}

/** Current counter state for one rate-limit key. */
export interface RateLimitEntry {
  /** Requests observed during the active window. */
  count: number;
  /** Unix timestamp in milliseconds when the active window resets. */
  resetAt: number;
}

/** Storage contract for rate-limit counters. */
export interface RateLimitStore {
  /** Increment a key and return its current window state. */
  increment(key: string, windowMs: number): Promise<RateLimitEntry>;
  /** Remove the counter for a key. */
  reset(key: string): Promise<void>;
}

/** Add a window duration without producing an unsafe JavaScript timestamp. */
export function calculateRateLimitResetAt(now: number, windowMs: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, now + windowMs);
}
