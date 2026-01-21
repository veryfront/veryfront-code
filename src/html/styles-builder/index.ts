export { generateThemeVariables } from "./theme-variables.ts";

export { getDevStyles } from "./dev-styles.ts";

export { getProductionStyles } from "./production-styles.ts";

// Tailwind CSS v4 JIT compiler - unified, native Tailwind
export {
  cacheCSS,
  clearCSSCache,
  compileGlobalsCSS,
  type CSSErrorInfo,
  extractCandidates,
  extractCandidatesFromFiles,
  formatCSSError,
  type GenerateOptions,
  generateTailwind4CSS,
  generateTailwindCSS,
  getCSSByHash,
  hashCSS,
  invalidateCompiler,
  type TailwindResult,
} from "./tailwind-compiler.ts";

// Class cache for project-wide class extraction
export {
  clearAllClasses,
  clearProjectClasses,
  extractClassesFromFiles,
  getClassCacheStats,
  getProjectClasses,
  updateProjectClasses,
} from "./class-cache.ts";
