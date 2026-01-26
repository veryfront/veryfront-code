import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { LayoutItem, MdxBundle } from "../../types/index.js";
export interface LayoutCompilerOptions {
    adapter: RuntimeAdapter;
    compileMDX: (content: string, frontmatter?: Record<string, unknown>, filePath?: string) => Promise<MdxBundle>;
}
export declare class LayoutCompiler {
    private adapter;
    private compileMDX;
    constructor(options: LayoutCompilerOptions);
    compileLayouts(layouts: LayoutItem[]): Promise<void>;
    computeDependencyHash(layoutBundle: MdxBundle | undefined, nestedLayouts: LayoutItem[]): Promise<string>;
}
//# sourceMappingURL=layout-compiler.d.ts.map