import type { RuntimeAdapter } from "../platform/adapters/base.js";
import type { VeryfrontConfig } from "../config/index.js";
import { type BundleManifestStore } from "./bundle-manifest.js";
export declare function initializeBundleManifest(config: VeryfrontConfig, mode: "development" | "production", adapter?: RuntimeAdapter): Promise<void>;
export declare function getBundleManifestTTL(config: VeryfrontConfig, mode: "development" | "production"): number | undefined;
export declare function warmupBundleManifest(store: BundleManifestStore, keys: string[]): Promise<void>;
//# sourceMappingURL=bundle-manifest-init.d.ts.map