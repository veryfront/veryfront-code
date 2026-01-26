import type { RenderMetadata } from "../types/index.js";
import type { HTMLMetadata } from "./types.js";
export interface ProcessedMetadata {
    metadata: HTMLMetadata;
    effectiveTitle: string;
    metaTags: string;
    linkTags: string;
    scriptTags: string;
    styleTags: string;
    lang: string;
    bodyClass: string;
}
export declare function processMetadata(meta: RenderMetadata): ProcessedMetadata;
//# sourceMappingURL=metadata-builder.d.ts.map