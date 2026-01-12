/**
 * Stub Module Generation
 *
 * Creates stub modules for missing files to prevent import errors.
 *
 * @module build/transforms/mdx/esm-loader/processor/stubs
 */

import { rendererLogger as logger } from "@veryfront/utils";
import { join } from "https://deno.land/std@0.220.0/path/mod.ts";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import { hashString } from "../cache/keys.ts";
import { getLocalFs } from "../local-fs.ts";

/**
 * Extract named exports from an import statement to create proper stub exports.
 */
export function extractNamedExports(
  moduleCode: string,
  originalImport: string,
  modulePath: string,
): string {
  const importNamePattern = new RegExp(
    `import\\s+(?:({[^}]+})|([\\w$]+))\\s*${originalImport.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
  );
  const importMatch = moduleCode.match(importNamePattern);

  if (!importMatch || !importMatch[1]) {
    return "";
  }

  // Named imports: import { a, b as c } from "..."
  const names = importMatch[1]
    .replace(/[{}]/g, "")
    .split(",")
    .map((n) => n.trim().split(/\s+as\s+/)[0]?.trim())
    .filter((n): n is string => !!n);

  return names
    .map((n) =>
      `export const ${n} = () => { console.warn('[Veryfront] Missing export "${n}" from "${modulePath}"'); return null; };`
    )
    .join("\n");
}

/**
 * Create a stub module for a missing file.
 *
 * @param modulePath - The path of the missing module
 * @param namedExports - Named exports to include in the stub
 * @param cacheDir - Cache directory to write the stub
 * @returns Path to the stub file
 */
export async function createStubModule(
  modulePath: string,
  namedExports: string,
  cacheDir: string,
): Promise<string> {
  const stubCode = `
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

  const stubHash = hashString(`stub:${modulePath}:${namedExports}`);
  const stubPath = join(cacheDir, `stub-${stubHash}.mjs`);

  try {
    await getLocalFs().writeTextFile(stubPath, stubCode);
    logger.warn(`${LOG_PREFIX_MDX_LOADER} Created stub for missing module: ${modulePath}`);
    return stubPath;
  } catch (e) {
    logger.error(`${LOG_PREFIX_MDX_LOADER} Failed to create stub for: ${modulePath}`, e);
    throw e;
  }
}
