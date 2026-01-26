import type { VeryfrontRenderer } from "../../../rendering/index.js";
import type { BuildStats } from "../../../server/build-types.js";
export declare function cleanupRenderer(renderer: VeryfrontRenderer): Promise<void>;
export declare function cleanupCaches(): Promise<void>;
export declare function performCleanup(renderer: VeryfrontRenderer): Promise<void>;
export declare function logBuildCompletion(stats: BuildStats): void;
//# sourceMappingURL=build-cleanup.d.ts.map