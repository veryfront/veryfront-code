import * as dntShim from "../../_dnt.shims.js";
import type { CacheBackend } from "./backend.js";
interface PendingRequest {
    key: string;
    resolve: (value: string | null) => void;
    reject: (error: Error) => void;
}
interface RequestCacheContext {
    cache: Map<string, string | null>;
    pending: Map<string, Promise<string | null>>;
    batchQueue: PendingRequest[];
    batchTimer: ReturnType<typeof dntShim.setTimeout> | null;
}
export declare function runWithCacheBatching<T>(fn: () => Promise<T>): Promise<T>;
export declare function getRequestCacheContext(): RequestCacheContext | undefined;
export declare function getCachedWithBatching(backend: CacheBackend, key: string): Promise<string | null>;
export declare function setInRequestCache(key: string, value: string | null): void;
export declare function getRequestCacheStats(): {
    hits: number;
    stored: number;
} | null;
export {};
//# sourceMappingURL=request-cache-batcher.d.ts.map