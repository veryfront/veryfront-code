/**
 * Build System Type Definitions
 * Consolidated from cli/commands/build/types.ts and server/build-types.ts
 */
export interface BuildOptions {
    projectDir: string;
    outputDir?: string;
    splitting?: boolean;
    compress?: boolean;
    prefetch?: boolean;
    enableSplitting?: boolean;
    enableCompression?: boolean;
    enablePrefetch?: boolean;
    ssg?: boolean;
    include?: string[];
    exclude?: string[];
    dryRun?: boolean;
}
export interface BuildStats {
    pages: number;
    components: number;
    chunks: number;
    assets: number;
    totalSize: number;
    duration: number;
    ssgPaths?: string[];
}
export interface RouteInfo {
    path: string;
    file: string;
    slug: string;
}
export interface AppRouteInfo {
    path: string;
    pageFile: string;
    segments: string[];
    segmentDirs: string[];
}
//# sourceMappingURL=build-types.d.ts.map