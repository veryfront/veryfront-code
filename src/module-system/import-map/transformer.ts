import type { ImportMapConfig, TransformOptions } from "./types.ts";
import { resolveImport } from "./resolver.ts";

export function transformImportsWithMap(
  code: string,
  importMap: ImportMapConfig,
  scope?: string,
  options?: TransformOptions,
): string {
  let transformedCode = code;

  transformedCode = transformedCode.replace(
    /((?:import|export)\s+(?:[\w,{ /* empty */ }\s*]+\s+from\s+)?|export\s+(?:\*|\{[^}]+\})\s+from\s+)["']([^"']+)["']/g,
    (_match, prefix, specifier) => {
      const isBare = !specifier.startsWith("http") &&
        !specifier.startsWith("/") &&
        !specifier.startsWith(".");
      if (isBare && !options?.resolveBare) {
        return `${prefix}"${specifier}"`;
      }
      const resolved = resolveImport(specifier, importMap, scope);
      return `${prefix}"${resolved}"`;
    },
  );

  transformedCode = transformedCode.replace(
    /from\s+["']([^"']+)["']/g,
    (match, specifier) => {
      const isBare = !specifier.startsWith("http") &&
        !specifier.startsWith("/") &&
        !specifier.startsWith(".");
      if (isBare && !options?.resolveBare) {
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
