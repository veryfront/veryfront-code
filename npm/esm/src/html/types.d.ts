import type { VeryfrontConfig } from "../config/index.js";
export type { HTMLMetadata, MDXFrontmatter } from "../transforms/mdx/types.js";
export type { ImportMapConfig } from "../modules/import-map/types.js";
export interface HTMLGenerationOptions {
    /**
     * @deprecated Use `options.isLocalDev` for environment checks.
     */
    mode: "development" | "production";
    config: VeryfrontConfig;
    importMap?: Record<string, string>;
    nestedLayouts?: Array<{
        kind: string;
        path?: string;
        componentPath?: string;
    }>;
    appPath?: string;
    pagePath?: string;
    pageType?: "mdx" | "md" | "tsx" | "jsx" | "ts" | "js";
    nonce?: string;
    /** Project directory for resolving package versions */
    projectDir?: string;
    /** Project's globals.css content (overrides default theme variables) */
    globalCSS?: string;
    /** Frontmatter for SPA client navigation */
    frontmatter?: Record<string, unknown>;
    /** Props for each layout keyed by layout path */
    layoutProps?: Record<string, Record<string, unknown>>;
    /** Whether page is embedded in Studio iframe */
    studioEmbed?: boolean;
    /** Project ID for Studio communication */
    projectId?: string;
    /** Page ID for Studio communication */
    pageId?: string;
    /** Hash of source code for Navigator tree sync detection */
    sourceHash?: string;
    /** User's preferred color scheme from Sec-CH-Prefers-Color-Scheme header or URL param */
    colorScheme?: "light" | "dark";
    /** Whether colorScheme was set via color_mode URL param (needs localStorage persistence) */
    colorSchemeFromParam?: boolean;
    /** Deployment environment (preview or production) */
    environment?: "preview" | "production";
    /** Headings extracted from MDX for sidebar/TOC navigation */
    headings?: Array<{
        id: string;
        text: string;
        level: number;
    }>;
    /** Tailwind classes extracted from all project source files */
    projectClasses?: Set<string>;
    /** Whether running in local development mode */
    isLocalDev?: boolean;
    /** Disable HMR scripts (for embedded iframes where WebSocket is unwanted) */
    noHmr?: boolean;
}
export interface HydrationData {
    slug: string;
    props: Record<string, unknown>;
    params: Record<string, string | string[]>;
    layouts: Array<{
        kind: string;
        path?: string;
    }>;
    appPath?: string;
    pagePath?: string;
}
//# sourceMappingURL=types.d.ts.map