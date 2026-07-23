import { join } from "#veryfront/compat/path";
import { getErrorCollector } from "#veryfront/observability";
import { rendererLogger as logger } from "#veryfront/utils";
import { getLocalFs } from "../cache/index.ts";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import { hashString } from "./hash.ts";
import { writeCacheFile } from "#veryfront/utils/cache-file-ops.ts";
import { errorLogName, fileLogLabel } from "../../../shared/log-context.ts";

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
        `export const ${name} = () => {
  const error = new Error('[Veryfront] Missing export "${name}" from "${modulePath}". This module or file does not exist in your project.');
  error.name = 'MissingModuleError';
  console.error('[Veryfront] A required module export is missing.');
  throw error;
};`,
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
    const error = new Error('[Veryfront] Missing module: ${modulePath}. Export "' + prop + '" was not found. This module or file does not exist in your project.');
    error.name = 'MissingModuleError';
    console.error('[Veryfront] A required module export is missing.');
    throw error;
  },
  apply() {
    const error = new Error('[Veryfront] Missing module: ${modulePath}. This module or file does not exist in your project.');
    error.name = 'MissingModuleError';
    console.error('[Veryfront] A required module is missing.');
    throw error;
  }
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
  const moduleFile = fileLogLabel(modulePath);
  const stubHash = hashString(`stub:${modulePath}:${namedImports.join(",")}`);
  const stubPath = join(esmCacheDir, `stub-${stubHash}.mjs`);
  const stubCode = generateStubCode(modulePath, namedImports);

  try {
    const written = await writeCacheFile(getLocalFs(), stubPath, stubCode, "MDX-STUB-CACHE");
    if (!written) return null;

    const errorMessage = namedImports.length
      ? `Missing module: ${moduleFile} (${namedImports.length} imports)`
      : `Missing module: ${moduleFile}`;

    try {
      getErrorCollector().addModuleError(errorMessage, moduleFile, {
        namedImportCount: namedImports.length,
      });
    } catch (_) {
      /* expected: error collector may not be initialized in all contexts */
    }

    logger.error(`${LOG_PREFIX_MDX_LOADER} Missing module`, {
      moduleFile,
      namedImportCount: namedImports.length,
    });

    return stubPath;
  } catch (error) {
    logger.error(`${LOG_PREFIX_MDX_LOADER} Failed to create module stub`, {
      moduleFile,
      errorName: errorLogName(error),
    });
    return null;
  }
}
