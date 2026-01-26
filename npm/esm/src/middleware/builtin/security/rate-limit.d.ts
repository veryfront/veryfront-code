import * as dntShim from "../../../../_dnt.shims.js";
import type { Middleware } from "../types.js";
import type { RateLimitEntry, RateLimitStore } from "./types.js";
export declare class MemoryRateLimitStore implements RateLimitStore {
    private counts;
    private cleanupInterval?;
    constructor(windowMs: number);
    increment(key: string, windowMs: number): Promise<RateLimitEntry>;
    reset(key: string): Promise<void>;
    destroy(): void;
}
export interface RateLimitOptions {
    maxRequests?: number;
    windowMs?: number;
    store?: RateLimitStore;
    keyGenerator?: (req: dntShim.Request) => string;
}
export declare function rateLimit(optionsOrMaxRequests?: number | RateLimitOptions, windowMsArg?: number): Middleware;
//# sourceMappingURL=rate-limit.d.ts.map