/**
 * Import discovery functions for the SSR VF Modules stage.
 */

/**
 * Find all /_vf_modules/_veryfront/ imports in the code.
 * Only matches framework modules, not user project files.
 */
export function findVfModuleImports(code: string): string[] {
  const imports: string[] = [];
  // Note: \s* allows zero whitespace (minified code: from"..." has no space)
  // Only match _veryfront/ framework modules, not user project files
  const pattern = /from\s*["'](\/\_vf\_modules\/_veryfront\/[^"']+)["']/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    imports.push(match[1]!);
  }

  return [...new Set(imports)];
}

/**
 * Find all relative imports (./foo, ../bar) in the code.
 * Returns array of specifiers.
 */
export function findRelativeImports(code: string): string[] {
  const imports: string[] = [];

  // Match: from "./foo" or from "../bar"
  const fromPattern = /from\s*["'](\.\.?\/[^"']+)["']/g;
  // Match side-effect imports: import "./foo" or import "../bar" (no `from`)
  const sideEffectPattern = /import\s*["'](\.\.?\/[^"']+)["']/g;

  let match: RegExpExecArray | null;
  while ((match = fromPattern.exec(code)) !== null) {
    imports.push(match[1]!);
  }
  while ((match = sideEffectPattern.exec(code)) !== null) {
    imports.push(match[1]!);
  }

  return [...new Set(imports)];
}
