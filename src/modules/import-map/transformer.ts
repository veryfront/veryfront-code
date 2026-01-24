import type { ImportMapConfig, TransformOptions } from "./types.ts";
import { resolveImport } from "./resolver.ts";

function shouldResolve(specifier: string, options?: TransformOptions): boolean {
  // esm.sh URLs with query params are already normalized - skip to prevent stripping external=react
  // URLs without query params (e.g., from npm packages) should be normalized
  if (specifier.startsWith("https://esm.sh/") || specifier.startsWith("http://esm.sh/")) {
    // If it has query params (contains ?), it's already been processed - don't re-process
    // This prevents multiple regex passes from stripping external=react from the URL
    return !specifier.includes("?");
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
