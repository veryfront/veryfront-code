import { createError, toError } from "../../../errors/veryfront-error.js";
import { setActiveSpanAttributes, withSpan } from "../../../observability/tracing/otlp-setup.js";
class FixedWindowLimiter {
    config;
    requests = new Map();
    constructor(config) {
        this.config = config;
    }
    check(identifier) {
        const now = Date.now();
        const entry = this.requests.get(identifier);
        if (!entry || now >= entry.resetAt) {
            const resetAt = now + this.config.windowMs;
            this.requests.set(identifier, { count: 1, resetAt });
            return {
                allowed: true,
                remaining: this.config.maxRequests - 1,
                resetAt,
            };
        }
        if (entry.count < this.config.maxRequests) {
            entry.count++;
            return {
                allowed: true,
                remaining: this.config.maxRequests - entry.count,
                resetAt: entry.resetAt,
            };
        }
        return {
            allowed: false,
            remaining: 0,
            resetAt: entry.resetAt,
            retryAfter: Math.ceil((entry.resetAt - now) / 1000),
        };
    }
    reset(identifier) {
        this.requests.delete(identifier);
    }
    clear() {
        this.requests.clear();
    }
}
class TokenBucketLimiter {
    config;
    buckets = new Map();
    refillRate;
    constructor(config) {
        this.config = config;
        this.refillRate = config.maxRequests / config.windowMs;
    }
    check(identifier) {
        const now = Date.now();
        const bucket = this.buckets.get(identifier);
        if (!bucket) {
            const newBucket = {
                tokens: this.config.maxRequests - 1,
                lastRefill: now,
            };
            this.buckets.set(identifier, newBucket);
            return {
                allowed: true,
                remaining: newBucket.tokens,
                resetAt: now + this.config.windowMs,
            };
        }
        const timePassed = now - bucket.lastRefill;
        const tokensToAdd = timePassed * this.refillRate;
        bucket.tokens = Math.min(this.config.maxRequests, bucket.tokens + tokensToAdd);
        bucket.lastRefill = now;
        if (bucket.tokens >= 1) {
            bucket.tokens--;
            return {
                allowed: true,
                remaining: Math.floor(bucket.tokens),
                resetAt: now + this.config.windowMs,
            };
        }
        const timeUntilToken = (1 - bucket.tokens) / this.refillRate;
        return {
            allowed: false,
            remaining: 0,
            resetAt: now + this.config.windowMs,
            retryAfter: Math.ceil(timeUntilToken / 1000),
        };
    }
    reset(identifier) {
        this.buckets.delete(identifier);
    }
    clear() {
        this.buckets.clear();
    }
}
function createLimiterByStrategy(config) {
    if (config.strategy === "fixed-window")
        return new FixedWindowLimiter(config);
    return new TokenBucketLimiter(config);
}
export function createRateLimiter(config) {
    const limiter = createLimiterByStrategy(config);
    function getIdentifier(context) {
        return config.identify?.(context ?? {}) ?? "default";
    }
    return {
        check(context) {
            return limiter.check(getIdentifier(context));
        },
        reset(context) {
            limiter.reset(getIdentifier(context));
        },
        clear() {
            limiter.clear();
        },
    };
}
export function rateLimitMiddleware(config) {
    const limiter = createRateLimiter(config);
    return function middleware(context, next) {
        return withSpan("agent.middleware.rateLimit", () => {
            const result = limiter.check(context);
            setActiveSpanAttributes({
                "rateLimit.allowed": result.allowed,
                "rateLimit.remaining": result.remaining,
                "rateLimit.strategy": config.strategy,
            });
            if (!result.allowed) {
                setActiveSpanAttributes({
                    "rateLimit.retryAfter": result.retryAfter ?? 0,
                });
                throw toError(createError({
                    type: "agent",
                    message: config.errorMessage ??
                        `Rate limit exceeded. Try again in ${result.retryAfter} seconds.`,
                }));
            }
            return next();
        }, {
            "rateLimit.strategy": config.strategy,
            "rateLimit.maxRequests": config.maxRequests,
        });
    };
}
