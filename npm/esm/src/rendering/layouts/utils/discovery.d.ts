import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import type { LayoutItem } from "../../../types/index.js";
/**
 * Clear the layout discovery cache.
 * Call this when config or layout files change to ensure HMR works correctly.
 */
export declare function clearLayoutDiscoveryCache(): void;
export declare function discoverNestedLayouts(pageFilePath: string, rootDir: string, projectDir: string, adapter: RuntimeAdapter): Promise<LayoutItem[]>;
//# sourceMappingURL=discovery.d.ts.map