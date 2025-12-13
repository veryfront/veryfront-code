import type { ImportMapConfig, TransformOptions } from "./types.ts";
import { resolveImport } from "./resolver.ts";

/**
 * Check if a specifier is a "bare" import (not URL, absolute, or relative path)
 */
function isBareSpecifier(specifier: string): boolean {
  return !specifier.startsWith("http") &&
    !specifier.startsWith("/") &&
    !specifier.startsWith(".");
}

/**
 * Transform import/export specifiers in code using an import map.
 *
 * Handles:
 * - Static imports: import x from "y", import { a } from "y"
 * - Static exports: export { a } from "y", export * from "y"
 * - Dynamic imports: import("y")
 */
export function transformImportsWithMap(
  code: string,
  importMap: ImportMapConfig,
  scope?: string,
  options?: TransformOptions,
): string {
  let transformedCode = code;

  // Handle static import/export statements with from clause
  // Matches: import x from "y", import { a, b } from "y", export { x } from "y", export * from "y"
  transformedCode = transformedCode.replace(
    /\b((?:import|export)\s+(?:[\w,{}\s*]+\s+from\s+|(?:\*|\{[^}]*\})\s+from\s+))["']([^"']+)["']/g,
    (match, prefix, specifier) => {
      if (isBareSpecifier(specifier) && !options?.resolveBare) {
        return match;
      }
      const resolved = resolveImport(specifier, importMap, scope);
      return `${prefix}"${resolved}"`;
    },
  );

  // Handle dynamic imports: import("x")
  transformedCode = transformedCode.replace(
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    (match, specifier) => {
      if (isBareSpecifier(specifier) && !options?.resolveBare) {
        return match;
      }
      const resolved = resolveImport(specifier, importMap, scope);
      return `import("${resolved}")`;
    },
  );

  return transformedCode;
}
