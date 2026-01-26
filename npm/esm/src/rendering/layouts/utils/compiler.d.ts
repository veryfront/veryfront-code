import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import type { LayoutItem, MdxBundle } from "../../../types/index.js";
export declare function compileMDXLayouts(layouts: LayoutItem[], compileMDX: (content: string, frontmatter?: Record<string, unknown>, filePath?: string) => Promise<MdxBundle>, adapter: RuntimeAdapter): Promise<void>;
//# sourceMappingURL=compiler.d.ts.map