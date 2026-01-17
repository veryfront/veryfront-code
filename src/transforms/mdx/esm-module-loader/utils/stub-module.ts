/**
 * Stub Module Generator
 *
 * Creates stub modules for missing files to prevent import errors during SSR.
 * This is used when a module cannot be resolved but the application should
 * still render with a warning rather than failing completely.
 *
 * @module build/transforms/mdx/esm-module-loader/utils/stub-module
 */

import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { rendererLogger as logger } from "@veryfront/utils";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import { hashString } from "./hash.ts";
import { getLocalFs } from "../cache/index.ts";

/**
 * Extract named imports from an import statement.
 * For example: `import { a, b as c } from "..."` returns ["a", "b"]
 */
export function extractNamedImports(
  code: string,
  importStatement: string,
): string[] {
  const escapedImport = importStatement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const importNamePattern = new RegExp(
    `import\\s+(?:({[^}]+})|([\\w$]+))\\s*${escapedImport}`,
  );
  const importMatch = code.match(importNamePattern);

  if (!importMatch?.[1]) {
    return [];
  }

  // Named imports: import { a, b as c } from "..."
  return importMatch[1]
    .replace(/[{}]/g, "")
    .split(",")
    .map((n) => n.trim().split(/\s+as\s+/)[0]?.trim())
    .filter((n): n is string => !!n);
}

/**
 * Generate named exports for stub module.
 */
function generateNamedExports(names: string[], modulePath: string): string {
  return names
    .map(
      (n) =>
        `export const ${n} = () => { console.warn('[Veryfront] Missing export "${n}" from "${modulePath}"'); return null; };`,
    )
    .join("\n");
}

/**
 * Generate stub module code for a missing module.
 * The stub uses a Proxy to handle any property access gracefully.
 */
export function generateStubCode(modulePath: string, namedImports: string[] = []): string {
  const namedExports = generateNamedExports(namedImports, modulePath);

  return `
// Stub module for missing file: ${modulePath}
// This file was not found in the project's published release.
const handler = {
  get(_, prop) {
    if (prop === 'default' || prop === '__esModule' || typeof prop === 'symbol') {
      return new Proxy({}, handler);
    }
    console.warn('[Veryfront] Missing module: ${modulePath}. Component "' + prop + '" was not found.');
    return () => null;
  },
  apply() { return null; }
};
export default new Proxy(function(){}, handler);
${namedExports}
`;
}

/**
 * Create a stub module file for a missing import.
 * Returns the file path of the created stub, or null if creation failed.
 */
export async function createStubModule(
  modulePath: string,
  code: string,
  importStatement: string,
  esmCacheDir: string,
): Promise<string | null> {
  const namedImports = extractNamedImports(code, importStatement);
  const stubCode = generateStubCode(modulePath, namedImports);
  const stubHash = hashString(`stub:${modulePath}:${namedImports.join(",")}`);
  const stubPath = join(esmCacheDir, `stub-${stubHash}.mjs`);

  try {
    await getLocalFs().writeTextFile(stubPath, stubCode);
    logger.warn(`${LOG_PREFIX_MDX_LOADER} Created stub for missing module: ${modulePath}`);
    return stubPath;
  } catch (error) {
    logger.error(`${LOG_PREFIX_MDX_LOADER} Failed to create stub for: ${modulePath}`, error);
    return null;
  }
}
