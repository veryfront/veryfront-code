import type { ImportMapConfig, TransformOptions } from "./types.ts";
import { resolveImport } from "./resolver.ts";

/**
 * Check if specifier should be processed by the import map.
 * - Bare imports (no path prefix): only if resolveBare option is set
 * - esm.sh URLs: always process (to normalize package instances)
 * - Other URLs/paths: process via import map
 */
function shouldResolve(specifier: string, options?: TransformOptions): boolean {
  // Always process esm.sh URLs to normalize them
  if (specifier.startsWith("https://esm.sh/") || specifier.startsWith("http://esm.sh/")) {
    return true;
  }

  const isBare = !specifier.startsWith("http") &&
    !specifier.startsWith("/") &&
    !specifier.startsWith(".");

  // Only process bare imports if resolveBare is set
  if (isBare && !options?.resolveBare) {
    return false;
  }

  return true;
}

export function transformImportsWithMap(
  code: string,
  importMap: ImportMapConfig,
  scope?: string,
  options?: TransformOptions,
): string {
  let transformedCode = code;

  transformedCode = transformedCode.replace(
    /((?:import|export)\s+(?:[\w,{}\s*]+\s+from\s+)?|export\s+(?:\*|\{[^}]+\})\s+from\s+)["']([^"']+)["']/g,
    (_match, prefix, specifier) => {
      if (!shouldResolve(specifier, options)) {
        return `${prefix}"${specifier}"`;
      }
      const resolved = resolveImport(specifier, importMap, scope);
      return `${prefix}"${resolved}"`;
    },
  );

  transformedCode = transformedCode.replace(
    /from\s+["']([^"']+)["']/g,
    (match, specifier) => {
      if (!shouldResolve(specifier, options)) {
        return match;
      }
      const resolved = resolveImport(specifier, importMap, scope);
      return `from "${resolved}"`;
    },
  );

  transformedCode = transformedCode.replace(
    /import\s*\(\s*["']([^"']+)["']\s*\)/g,
    (_match, specifier) => {
      const resolved = resolveImport(specifier, importMap, scope);
      return `import("${resolved}")`;
    },
  );

  return transformedCode;
}
