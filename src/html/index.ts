export type { HTMLMetadata, MDXFrontmatter } from "./types.ts";
export type { InjectHTMLContentOptions } from "./html-injection.ts";

export { buildAttributes, escapeHTML } from "./html-escape.ts";

export { isFullHTMLDocument } from "./html-detection.ts";

export { extractHTMLMetadata } from "./metadata-extraction.ts";

export {
  generateLinkTags,
  generateMetaTags,
  generateScriptTags,
  generateStyleTags,
} from "./tag-generators.ts";

export { injectHTMLContent } from "./html-injection.ts";

export { wrapInHTMLShell } from "./html-shell-generator.ts";

export type { HTMLGenerationOptions, HydrationData, ImportMapConfig } from "./types.ts";

export { processMetadata } from "./metadata-builder.ts";
export type { ProcessedMetadata } from "./metadata-builder.ts";

export {
  generateHydrationData,
  getDevScripts,
  getProdScripts,
} from "./hydration-script-builder/index.ts";

export { getDevStyles } from "./dev-scripts.ts";

export {
  generateTailwindConfig,
  generateThemeVariables,
  getProductionStyles,
} from "./styles-builder/index.ts";

export {
  buildContentAttributes,
  buildImportMapJson,
  buildRootAttributes,
  shouldDisableLayout,
} from "./utils.ts";
