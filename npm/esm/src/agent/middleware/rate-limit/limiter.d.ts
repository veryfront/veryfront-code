export interface RateLimitConfig {
    strategy: "fixed-window" | "sliding-window" | "token-bucket";
    maxRequests: number;
    windowMs: number;
    identify?: (context: Record<string, unknown>) => string;
    errorMessage?: string;
}
export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetAt: number;
    retryAfter?: number;
}
export declare function createRateLimiter(config: RateLimitConfig): {
    check: (context?: Record<string, unknown>) => RateLimitResult;
    reset: (context?: Record<string, unknown>) => void;
    clear: () => void;
};
export declare function rateLimitMiddleware(config: RateLimitConfig): <T>(context: Record<string, unknown>, next: () => Promise<T>) => Promise<T>;
//# sourceMappingURL=limiter.d.ts.map