export interface BundleMetadata {
    hash: string;
    codeHash: string;
    size: number;
    compiledAt: number;
    source: string;
    mode: "development" | "production";
    meta?: {
        type?: "mdx" | "component" | "layout" | "provider";
        depsHash?: string;
        reactVersion?: string;
        /** Headings extracted from MDX for sidebar/TOC navigation */
        headings?: Array<{
            id: string;
            text: string;
            level: number;
        }>;
    };
}
export interface BundleCode {
    code: string;
    sourceMap?: string;
    css?: string;
}
export interface BundleManifestStore {
    getBundleMetadata(key: string): Promise<BundleMetadata | undefined>;
    setBundleMetadata(key: string, metadata: BundleMetadata, ttlMs?: number): Promise<void>;
    getBundleCode(hash: string): Promise<BundleCode | undefined>;
    setBundleCode(hash: string, code: BundleCode, ttlMs?: number): Promise<void>;
    deleteBundle(key: string): Promise<void>;
    invalidateSource(source: string): Promise<number>;
    clear(): Promise<void>;
    isAvailable(): Promise<boolean>;
    getStats(): Promise<{
        totalBundles: number;
        totalSize: number;
        oldestBundle?: number;
        newestBundle?: number;
    }>;
}
export declare class InMemoryBundleManifestStore implements BundleManifestStore {
    private metadata;
    private code;
    private sourceIndex;
    private getIfNotExpired;
    getBundleMetadata(key: string): Promise<BundleMetadata | undefined>;
    setBundleMetadata(key: string, metadata: BundleMetadata, ttlMs?: number): Promise<void>;
    getBundleCode(hash: string): Promise<BundleCode | undefined>;
    setBundleCode(hash: string, code: BundleCode, ttlMs?: number): Promise<void>;
    deleteBundle(key: string): Promise<void>;
    invalidateSource(source: string): Promise<number>;
    clear(): Promise<void>;
    isAvailable(): Promise<boolean>;
    getStats(): Promise<{
        totalBundles: number;
        totalSize: number;
        oldestBundle?: number;
        newestBundle?: number;
    }>;
}
export declare function setBundleManifestStore(store: BundleManifestStore): void;
export declare function getBundleManifestStore(): BundleManifestStore;
export { computeCodeHash, computeContentHash } from "./hash-utils.js";
//# sourceMappingURL=bundle-manifest.d.ts.map