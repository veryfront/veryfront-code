import type { OptimizedImageMetadata } from "./types.js";
export declare function writeManifest(imageManifest: Map<string, OptimizedImageMetadata>, outputDir: string): Promise<void>;
export declare function loadManifest(outputDir: string): Promise<Map<string, OptimizedImageMetadata>>;
//# sourceMappingURL=manifest-manager.d.ts.map