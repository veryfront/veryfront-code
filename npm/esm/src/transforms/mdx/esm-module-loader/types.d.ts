import type { LRUCache } from "../../../utils/lru-wrapper.js";
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import type { MDXModule } from "../types.js";
export interface ESMLoaderContext {
    esmCacheDir?: string;
    moduleCache: LRUCache<string, MDXModule>;
    adapter?: RuntimeAdapter;
    projectId?: string;
    projectDir?: string;
    projectSlug?: string;
    contentSourceId?: string;
}
export interface FSAdapter {
    readFile(path: string): Promise<string | Uint8Array>;
    mkdir(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    writeFile(path: string, content: string | Uint8Array): Promise<void>;
    stat(path: string): Promise<{
        isFile?: boolean;
    } | null>;
    makeTempDir(prefix: string): Promise<string>;
}
export interface ImportMatch {
    original: string;
    path: string;
}
export interface ModuleFetchResult {
    original: string;
    filePath: string | null;
    path: string;
}
export interface NestedImportResult {
    original: string;
    nestedFilePath: string | null;
    nestedPath?: string;
    relativePath?: string;
}
export interface ModuleFetcherContext {
    esmCacheDir: string;
    adapter: RuntimeAdapter;
    projectDir: string;
    projectId: string;
    projectSlug?: string;
    isLocalDev?: boolean;
    /**
     * Tracks modules currently being processed to detect circular imports.
     * Key: normalized module path, Value: promise resolving to cached path.
     * This prevents infinite recursion when A imports B which imports A.
     */
    inFlightModules?: Map<string, Promise<string | null>>;
}
export interface JSXTransform {
    original: string;
    transformed: string;
}
//# sourceMappingURL=types.d.ts.map