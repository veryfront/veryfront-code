export { getDevStyles } from "./dev-scripts.js";
export { isFullHTMLDocument } from "./html-detection.js";
export { buildAttributes, escapeHTML, escapeHtml } from "./html-escape.js";
export type { InjectHTMLContentOptions } from "./html-injection.js";
export { injectHTMLContent } from "./html-injection.js";
export { generateHTMLShellParts, wrapInHTMLShell } from "./html-shell-generator.js";
export {
  generateHydrationData,
  getDevScripts,
  getProdScripts,
} from "./hydration-script-builder/index.js";
export type { ProcessedMetadata } from "./metadata-builder.js";
export { processMetadata } from "./metadata-builder.js";
export { extractHTMLMetadata } from "./metadata-extraction.js";
export { generateThemeVariables, getProductionStyles } from "./styles-builder/index.js";
export {
  generateLinkTags,
  generateMetaTags,
  generateScriptTags,
  generateStyleTags,
} from "./tag-generators.js";
export type {
  HTMLGenerationOptions,
  HTMLMetadata,
  HydrationData,
  ImportMapConfig,
  MDXFrontmatter,
} from "./types.js";
export {
  buildContentAttributes,
  buildImportMapJson,
  buildRootAttributes,
  shouldDisableLayout,
} from "./utils.js";
