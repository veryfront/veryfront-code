import type { Middleware } from "./types.js";
import { type RuntimeEnv } from "../../config/runtime-env.js";
export interface TimeoutOptions {
    /** Timeout in milliseconds (default: 60000) */
    timeoutMs?: number;
    /** Custom message for timeout response */
    message?: string;
    /** Paths to exclude from timeout (e.g., health checks) */
    exclude?: string[];
}
/**
 * Creates a middleware that enforces request timeouts.
 *
 * If a request takes longer than the configured timeout, the middleware
 * returns a 504 Gateway Timeout response.
 */
export declare function timeout(options?: TimeoutOptions): Middleware;
/**
 * Gets timeout from environment variable REQUEST_TIMEOUT_MS
 *
 * @param env - Optional RuntimeEnv for test isolation
 */
export declare function getTimeoutFromEnv(env?: RuntimeEnv): number;
/**
 * Creates a timeout middleware with configuration from environment
 */
export declare function timeoutFromEnv(options?: Omit<TimeoutOptions, "timeoutMs">): Middleware;
//# sourceMappingURL=timeout.d.ts.map