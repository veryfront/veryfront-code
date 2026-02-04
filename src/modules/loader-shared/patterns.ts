/**
 * Unified Import Pattern Definitions
 * Used across MDX, SSR, and orchestrator loaders
 */

// JSX file imports
export const JSX_IMPORT_PATTERN =
  /import\s+([^'"]+)\s+from\s+['"]file:\/\/([^'"]+\.(js|jsx|ts|tsx))['"];?/g;

// React detection
export const REACT_IMPORT_PATTERN = /import\s+.*React.*\s+from\s+['"]react['"]/;

// @/ alias imports
export const PROJECT_ALIAS_IMPORT_PATTERN = /import\s+([^'"]+)\s+from\s+['"]@\/([^'"]+)['"];?/g;

// /_vf_modules/ imports
export const MODULE_SERVER_IMPORT_PATTERN = /from\s*["']\/?_vf_modules\/([^"']+)["']/g;

// Matches /_vf_modules/... and file:///_vf_modules/... imports (with optional query params)
export const VF_MODULE_IMPORT_PATTERN =
  /from\s*["']((?:file:\/\/)?\/?\/?_vf_modules\/[^"'?]+)(?:\?[^"']*)?["']/g;

export const UNRESOLVED_VF_MODULES_PATTERN =
  /from\s*["']((?:file:\/\/)?\/?\/?_vf_modules\/[^"']+)["']/g;

// Relative imports
export const RELATIVE_IMPORT_PATTERN = /from\s*["'](\.\.?\/[^"'?]+)(?:\?[^"']*)?["']/g;

// Static/dynamic import detection
export const STATIC_IMPORT_PATTERN = /import\s+(?:(?:[\w*\s{},]*)\s+from\s+)?['"]([^'"]+)['"]/g;
export const DYNAMIC_IMPORT_PATTERN = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
export const EXPORT_FROM_PATTERN = /export\s+(?:[\w*\s{},]*)\s+from\s+['"]([^'"]+)['"]/g;

// Module extensions
export const MODULE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mdx"] as const;

// Utility
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
