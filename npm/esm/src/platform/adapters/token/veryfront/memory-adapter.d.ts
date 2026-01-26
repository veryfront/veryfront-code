import type { TokenStorageAdapter } from "./types.js";
export declare class MemoryTokenAdapter implements TokenStorageAdapter {
    private storage;
    constructor();
    initialize(): Promise<void>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    list(prefix?: string): Promise<string[]>;
    dispose(): void;
    get size(): number;
    clear(): void;
}
//# sourceMappingURL=memory-adapter.d.ts.map