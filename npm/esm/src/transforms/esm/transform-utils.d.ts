import type { Loader } from "esbuild";
/**
 * Compute a short 8-character content hash for cache keys.
 * Use this for transform cache keys where a compact hash is preferred.
 */
export declare function computeShortContentHash(content: string): Promise<string>;
/** @deprecated Use computeShortContentHash instead to avoid naming collision with full hash version */
export declare const computeContentHash: typeof computeShortContentHash;
export declare function getLoaderFromPath(filePath: string): Loader;
export declare function needsTransform(filePath: string): boolean;
//# sourceMappingURL=transform-utils.d.ts.map