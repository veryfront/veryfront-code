export { getDevStyles } from "./dev-scripts.ts";
export { isFullHTMLDocument } from "./html-detection.ts";

export { buildAttributes, escapeHTML, escapeHtml } from "./html-escape.ts";
export type { InjectHTMLContentOptions } from "./html-injection.ts";
export { injectHTMLContent } from "./html-injection.ts";
export { generateHTMLShellParts, wrapInHTMLShell } from "./html-shell-generator.ts";
export {
  generateHydrationData,
  getDevScripts,
  getProdScripts,
} from "./hydration-script-builder/index.ts";
export type { ProcessedMetadata } from "./metadata-builder.ts";
export { processMetadata } from "./metadata-builder.ts";
export { extractHTMLMetadata } from "./metadata-extraction.ts";
export { generateThemeVariables, getProductionStyles } from "./styles-builder/index.ts";
export {
  generateLinkTags,
  generateMetaTags,
  generateScriptTags,
  generateStyleTags,
} from "./tag-generators.ts";
export type {
  HTMLGenerationOptions,
  HTMLMetadata,
  HydrationData,
  ImportMapConfig,
  MDXFrontmatter,
} from "./types.ts";

export {
  buildContentAttributes,
  buildImportMapJson,
  buildRootAttributes,
  shouldDisableLayout,
} from "./utils.ts";
