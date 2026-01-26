import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { EntityInfo, LayoutItem, MdxBundle } from "../../types/index.js";
import type { VeryfrontConfig } from "../../config/index.js";
export interface LayoutCollectionResult {
    layoutBundle: MdxBundle | undefined;
    nestedLayouts: LayoutItem[];
}
export interface LayoutCollectorOptions {
    projectDir: string;
    adapter: RuntimeAdapter;
    config: VeryfrontConfig;
    compileMDX: (content: string, frontmatter?: Record<string, unknown>, filePath?: string) => Promise<MdxBundle>;
}
export declare class LayoutCollector {
    private projectDir;
    private adapter;
    private config;
    private compileMDX;
    constructor(options: LayoutCollectorOptions);
    collectLayouts(pageInfo: EntityInfo): Promise<LayoutCollectionResult>;
    private processLayoutResult;
    private collectNamedLayoutWithPath;
    private collectNestedLayouts;
    private collectAPILayoutConfiguration;
    private collectFilesystemLayouts;
}
//# sourceMappingURL=layout-collector.d.ts.map