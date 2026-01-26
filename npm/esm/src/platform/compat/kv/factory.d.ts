import type { Kv } from "./types.js";
export declare function openKv(path?: string): Promise<Kv>;
export declare function createKVStore(options?: {
    path?: string;
}): Promise<Kv>;
export declare function polyfillDenoKv(): void;
//# sourceMappingURL=factory.d.ts.map