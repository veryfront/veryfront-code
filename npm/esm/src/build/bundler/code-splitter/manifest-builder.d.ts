import type { Metafile } from "esbuild";
import type { ChunkInfo, ChunkManifest, MetafileOutput } from "./types.js";
/** Extracts entry name from entry point path */
export declare function extractEntryName(entryPoint: string): string;
/** Extracts chunk name from file path */
export declare function extractChunkName(file: string): string;
/** Calculates SHA-256 hash of file content (returns first 8 hex chars) */
export declare function calculateFileHash(content: Uint8Array): Promise<string>;
/** Determines which imports are critical and should be preloaded */
export declare function isCriticalImport(path: string): boolean;
/** Gets preload hints for critical imports */
export declare function getPreloadHints(output: MetafileOutput, outDir: string): string[];
/** Extracts chunk information from metafile output */
export declare function getChunkInfo(file: string, output: MetafileOutput, outDir: string): Promise<ChunkInfo>;
/** Adds a route entry to the manifest */
export declare function addRouteToManifest(manifest: ChunkManifest, output: MetafileOutput, relativePath: string, routeMap: Map<string, string>, outDir: string): void;
/** Builds complete chunk manifest from esbuild metafile */
export declare function buildManifest(metafile: Metafile, routeMap: Map<string, string>, outDir: string): Promise<ChunkManifest>;
/** Writes manifest to disk as JSON */
export declare function writeManifest(manifest: ChunkManifest, outDir: string): Promise<void>;
//# sourceMappingURL=manifest-builder.d.ts.map