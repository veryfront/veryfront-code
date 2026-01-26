import type { AppRouteInfo, BuildStats, RouteInfo } from "../../server/build-types.js";
export interface ManifestChunkInfo {
    file: string;
    css?: string;
    imports?: string[];
}
interface ChunkManifest {
    version: string;
    routes: Record<string, {
        chunks: string[];
    }>;
    chunks: Record<string, ManifestChunkInfo>;
    shared: string[];
}
export interface BuildManifest {
    version: string;
    buildTime: string;
    features: {
        streaming: boolean;
        codeSplitting: boolean;
        clientRouting: boolean;
        prefetching: boolean;
        compression: boolean;
    };
    routes: Array<{
        path: string;
        slug: string;
        chunks: string[];
    }>;
    chunks: ChunkManifest | null;
    stats: {
        pages: number;
        chunks: number;
        assets: number;
        totalSize: string;
    };
}
export interface ManifestOptions {
    routes: RouteInfo[];
    appRoutes: AppRouteInfo[];
    stats: BuildStats;
    enableSplitting: boolean;
    enablePrefetch: boolean;
    enableCompression: boolean;
    chunkManifest: ChunkManifest | null;
}
export declare function generateManifest(options: ManifestOptions): BuildManifest;
export declare function generateRedirects(): string;
export {};
//# sourceMappingURL=manifest.d.ts.map