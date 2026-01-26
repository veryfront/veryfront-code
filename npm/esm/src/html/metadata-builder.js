import { extractHTMLMetadata } from "./metadata-extraction.js";
import { generateLinkTags, generateMetaTags, generateScriptTags, generateStyleTags, } from "./tag-generators.js";
export function processMetadata(meta) {
    const metadata = extractHTMLMetadata(meta.frontmatter ?? {}, meta.layoutFrontmatter ?? {});
    const effectiveTitle = meta.frontmatter?.title ?? meta.title ?? metadata.title ?? "Veryfront App";
    return {
        metadata,
        effectiveTitle,
        metaTags: generateMetaTags(metadata),
        linkTags: generateLinkTags(metadata),
        scriptTags: generateScriptTags(metadata),
        styleTags: generateStyleTags(metadata),
        lang: typeof metadata.lang === "string" ? metadata.lang : "en",
        bodyClass: typeof metadata.bodyClass === "string" ? metadata.bodyClass : "",
    };
}
