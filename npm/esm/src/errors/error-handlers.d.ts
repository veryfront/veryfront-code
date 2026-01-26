import { serverLogger } from "../utils/logger/logger.js";
import { VeryfrontError } from "./types.js";
export declare function handleError(error: Error): void;
export declare function wrapError(error: unknown, message: string, context?: unknown): VeryfrontError;
export declare function logAndThrow(error: unknown, message?: string, logger?: typeof serverLogger): never;
export declare function handleErrorWithFallback<T>(fn: () => T | Promise<T>, fallback: T, logger?: typeof serverLogger): Promise<T>;
export declare function handleErrorWithFallbackSync<T>(fn: () => T, fallback: T, logger?: typeof serverLogger): T;
export declare function retryWithBackoff<T>(fn: () => Promise<T>, options?: {
    maxRetries?: number;
    initialDelay?: number;
    maxDelay?: number;
    logger?: typeof serverLogger;
}): Promise<T>;
//# sourceMappingURL=error-handlers.d.ts.map