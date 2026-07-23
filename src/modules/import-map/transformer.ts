import type { ImportMapConfig, TransformOptions } from "./types.ts";
import { resolveImport } from "./resolver.ts";
import { rewriteModuleSpecifiers } from "../loader-shared/import-specifiers.ts";
import { sanitizeImportMap } from "./merger.ts";

const MAX_TRANSFORM_SOURCE_BYTES = 10 * 1024 * 1024;

function shouldResolve(specifier: string, options?: TransformOptions): boolean {
  if (specifier.startsWith("https://esm.sh/") || specifier.startsWith("http://esm.sh/")) {
    return true;
  }

  const isBare = !specifier.startsWith("http") && !specifier.startsWith("/") &&
    !specifier.startsWith(".");

  if (isBare && !options?.resolveBare) return false;

  return true;
}

export function transformImportsWithMap(
  code: string,
  importMap: ImportMapConfig,
  scope?: string,
  options?: TransformOptions,
): string {
  if (new TextEncoder().encode(code).byteLength > MAX_TRANSFORM_SOURCE_BYTES) {
    throw new RangeError("Import-map transform source exceeds size limit");
  }
  const sanitizedMap = sanitizeImportMap(importMap);
  if (!sanitizedMap) throw new TypeError("Invalid import map");
  return rewriteModuleSpecifiers(code, (specifier) => {
    if (!shouldResolve(specifier, options)) return null;
    return resolveImport(specifier, sanitizedMap, scope);
  });
}
