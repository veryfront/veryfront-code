import type { VeryfrontConfig } from "../../config/index.js";
import type { CollectedHead } from "../../react/head-collector.js";
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { EntityInfo, LayoutItem, MdxBundle, PageBundle } from "../../types/index.js";
import type { RenderOptions } from "./types.js";
export interface HTMLGeneratorConfig {
    projectDir: string;
    adapter: RuntimeAdapter;
    config: VeryfrontConfig;
    mode: "development" | "production";
}
export interface HTMLGenerationContext {
    html: string;
    pageInfo: EntityInfo;
    pageBundle: PageBundle;
    layoutBundle: MdxBundle | undefined;
    nestedLayouts: LayoutItem[];
    collectedMetadata: Record<string, unknown>;
    slug: string;
    ssrHash: string;
    options?: RenderOptions;
    collectedHead?: CollectedHead;
}
export declare class HTMLGenerator {
    private config;
    constructor(config: HTMLGeneratorConfig);
    generateFullHTML(context: HTMLGenerationContext): Promise<string>;
    generateHTMLStream(reactStream: ReadableStream, context: Omit<HTMLGenerationContext, "html">): Promise<ReadableStream>;
    private handleFullHTMLDocument;
    private wrapHTMLFragment;
    private generateShellParts;
    private buildHeadElements;
    private mergeFrontmatter;
    private resolveAppPath;
    private loadProjectFile;
    private buildHTMLOptions;
    private extractProjectClasses;
}
//# sourceMappingURL=html.d.ts.map