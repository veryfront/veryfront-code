import type { HTMLMetadata } from "../transforms/mdx/types.js";
export interface InjectHTMLContentOptions {
    mode: string;
    slug: string;
    devPort?: number;
    /** Absolute path to the page file, used for 'use client' hydration */
    pagePath?: string;
    /** Whether the page has 'use client' directive */
    isClientPage?: boolean;
    /** Whether page is embedded in Studio iframe */
    studioEmbed?: boolean;
    /** Project ID for Studio communication */
    projectId?: string;
    /** Page ID for Studio communication */
    pageId?: string;
    /** CSP nonce */
    nonce?: string;
}
export declare function injectHTMLContent(template: string, content: string, metadata: HTMLMetadata, options: InjectHTMLContentOptions): string;
//# sourceMappingURL=html-injection.d.ts.map