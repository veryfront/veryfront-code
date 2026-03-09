export type RateLimitStrategy = "token-bucket" | "sliding-window" | "fixed-window";

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
  strategy?: RateLimitStrategy;
  keyGenerator?: (request: Request) => string;
  onRateLimitExceeded?: (request: Request, key: string) => Response | Promise<Response>;
  skip?: (request: Request) => boolean | Promise<boolean>;
  message?: string;
  store?: RateLimitStore;
  /** When true, trust X-Forwarded-For / X-Real-IP headers for client identification.
   *  Only enable when the server is behind a trusted reverse proxy. Defaults to false. */
  trustProxy?: boolean;
}

export interface RateLimitStore {
  increment(key: string): Promise<number>;
  get(key: string): Promise<number>;
  reset(key: string): Promise<void>;
  resetAll(): Promise<void>;
}

export interface RateLimitState {
  count: number;
  resetTime: number;
  requestTimestamps?: number[];
}
