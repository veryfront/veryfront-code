import { join } from "../../../../../deps/deno.land/std@0.220.0/path/mod.js";
import { rendererLogger as logger } from "../../../../utils/index.js";
import { LOG_PREFIX_MDX_LOADER } from "../constants.js";
import { getLocalFs } from "../cache/index.js";
import { hashString } from "./hash.js";

export function extractNamedImports(
  code: string,
  importStatement: string,
): string[] {
  const escapedImport = importStatement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const importNamePattern = new RegExp(
    `import\\s+(?:({[^}]+})|([\\w$]+))\\s*${escapedImport}`,
  );
  const importMatch = code.match(importNamePattern);

  if (!importMatch?.[1]) return [];

  return importMatch[1]
    .replace(/[{}]/g, "")
    .split(",")
    .map((n) => n.trim().split(/\s+as\s+/)[0]?.trim())
    .filter((n): n is string => !!n);
}

function generateNamedExports(names: string[], modulePath: string): string {
  return names
    .map(
      (name) =>
        `export const ${name} = () => { console.warn('[Veryfront] Missing export "${name}" from "${modulePath}"'); return null; };`,
    )
    .join("\n");
}

export function generateStubCode(
  modulePath: string,
  namedImports: string[] = [],
): string {
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

export async function createStubModule(
  modulePath: string,
  code: string,
  importStatement: string,
  esmCacheDir: string,
): Promise<string | null> {
  const namedImports = extractNamedImports(code, importStatement);
  const stubHash = hashString(`stub:${modulePath}:${namedImports.join(",")}`);
  const stubPath = join(esmCacheDir, `stub-${stubHash}.mjs`);
  const stubCode = generateStubCode(modulePath, namedImports);

  try {
    await getLocalFs().writeTextFile(stubPath, stubCode);
    logger.warn(
      `${LOG_PREFIX_MDX_LOADER} Created stub for missing module: ${modulePath}`,
    );
    return stubPath;
  } catch (error) {
    logger.error(
      `${LOG_PREFIX_MDX_LOADER} Failed to create stub for: ${modulePath}`,
      error,
    );
    return null;
  }
}
