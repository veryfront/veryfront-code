export { generateThemeVariables } from "./theme-variables.ts";

export {
  convertTailwindConfigForBrowser,
  generateTailwindConfig,
  generateTailwindV4Theme,
  getTailwindCDNUrl,
} from "./tailwind-config.ts";

export { getDevStyles } from "./dev-styles.ts";

export { getProductionStyles } from "./production-styles.ts";

// Tailwind 4 JIT compiler (replaces UnoCSS for consistent dev/prod styling)
export {
  generateCSSFromSources,
  generateTailwindCSS as generateTailwind4CSS,
} from "./tailwind4-compiler.ts";

// Build-time directive stripping for browser CDN compatibility
export { stripTailwindBuildDirectives } from "./strip-directives.ts";
