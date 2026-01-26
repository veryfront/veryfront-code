import type { RuntimeAdapter, RuntimeId } from "./base.js";
type AdapterLoader = () => Promise<RuntimeAdapter>;
declare class AdapterRegistry {
    private instance;
    private initialized;
    private initializationPromise;
    private loaders;
    constructor();
    get(): Promise<RuntimeAdapter>;
    private doInitialize;
    set(adapter: RuntimeAdapter): Promise<void>;
    getSync(): RuntimeAdapter;
    isInitialized(): boolean;
    reset(): Promise<void>;
    registerLoader(id: RuntimeId, loader: AdapterLoader, options?: {
        overwrite?: boolean;
    }): void;
}
export declare const runtime: AdapterRegistry;
export declare function getLocalAdapter(): Promise<RuntimeAdapter>;
export declare function resetLocalAdapter(): Promise<void>;
export type { RuntimeAdapter, RuntimeId } from "./base.js";
//# sourceMappingURL=registry.d.ts.map