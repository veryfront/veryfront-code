import type { CSSBundle } from "../../../types/index.js";
type CacheStats = {
    totalFiles: number;
    originalSize: number;
    minifiedSize: number;
    totalSavings: number;
    averageSavings: number;
};
export declare class CacheManager {
    private bundles;
    private cachedStats;
    addBundle(key: string, bundle: CSSBundle): void;
    getBundle(key: string): CSSBundle | undefined;
    getAllBundles(): Map<string, CSSBundle>;
    clear(): void;
    size(): number;
    writeManifest(outputDir: string): Promise<void>;
    getTotalSavings(): string;
    getStats(): CacheStats;
}
export declare function loadCSSManifest(outputDir?: string): Promise<Map<string, CSSBundle>>;
export {};
//# sourceMappingURL=css-bundle-cache.d.ts.map