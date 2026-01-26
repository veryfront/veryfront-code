import { type VeryfrontRenderer } from "../../../rendering/index.js";
import type { BuildOptions, BuildStats } from "../../../server/build-types.js";
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import type { VeryfrontConfig } from "../../../config/index.js";
export interface BuildContext {
    adapter: RuntimeAdapter;
    config: VeryfrontConfig;
    renderer: VeryfrontRenderer;
    options: BuildOptions;
    stats: BuildStats;
}
export declare function initializeBuildContext(options: BuildOptions): Promise<BuildContext>;
export declare function normalizeBuildOptions(options: BuildOptions): BuildOptions;
//# sourceMappingURL=build-initializer.d.ts.map