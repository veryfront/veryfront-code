import { join, toFileUrl } from "#veryfront/compat/path";
import type { ModuleSourceCapture } from "#veryfront/transforms/esm/module-source-capture.ts";
import { getErrorCollector } from "#veryfront/observability/error-collector.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { getLocalFs } from "../cache/index.ts";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import { hashString } from "./hash.ts";

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
  console.error(error.message);
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
    console.error(error.message);
    throw error;
  },
  apply() {
    const error = new Error('[Veryfront] Missing module: ${modulePath}. This module or file does not exist in your project.');
    error.name = 'MissingModuleError';
    console.error(error.message);
    throw error;
  }
};
export default new Proxy(function(){}, handler);
${namedExports}
`;
}

export interface DeferredImportErrorDescriptor {
  name: string;
  message: string;
}

function generateDeferredImportFailureCode(
  modulePath: string,
  deferredError?: DeferredImportErrorDescriptor,
): string {
  const message = JSON.stringify(
    deferredError?.message ??
      `[Veryfront] Missing module: ${modulePath}. This module or file does not exist in your project.`,
  );
  const name = JSON.stringify(deferredError?.name ?? "MissingModuleError");
  return `const error = new Error(${message});
error.name = ${name};
throw error;
`;
}

export interface CreateStubModuleOptions {
  /** Borrowed generation capture; captured stubs are not written to the host cache. */
  sourceCapture?: ModuleSourceCapture;
  /** Reject a dynamic import when it executes instead of exporting fallback values. */
  failOnImport?: boolean;
  /** Sanitized typed error to throw when a strict dynamic import executes. */
  deferredError?: DeferredImportErrorDescriptor;
}

export async function createStubModule(
  modulePath: string,
  code: string,
  importStatement: string,
  esmCacheDir: string,
  options: CreateStubModuleOptions = {},
): Promise<string | null> {
  const namedImports = extractNamedImports(code, importStatement);
  const behavior = options.failOnImport ? "fail-on-import" : "fallback";
  const deferredIdentity = options.deferredError
    ? `${options.deferredError.name}:${options.deferredError.message}`
    : "";
  const stubHash = hashString(
    `stub:${behavior}:${modulePath}:${namedImports.join(",")}:${deferredIdentity}`,
  );
  const stubPath = join(esmCacheDir, `stub-${stubHash}.mjs`);
  const stubCode = options.failOnImport
    ? generateDeferredImportFailureCode(modulePath, options.deferredError)
    : generateStubCode(modulePath, namedImports);

  if (options.sourceCapture) {
    options.sourceCapture.record(toFileUrl(stubPath).href, stubCode);
    return stubPath;
  }

  try {
    await getLocalFs().writeTextFile(stubPath, stubCode);

    if (!options.failOnImport) {
      const errorMessage = namedImports.length
        ? `Missing module: ${modulePath} (imports: ${namedImports.join(", ")})`
        : `Missing module: ${modulePath}`;

      try {
        getErrorCollector().addModuleError(errorMessage, modulePath, {
          namedImports,
          importStatement,
        });
      } catch (_) {
        /* expected: error collector may not be initialized in all contexts */
      }

      logger.error(`${LOG_PREFIX_MDX_LOADER} Missing module: ${modulePath}`, {
        namedImports,
      });
    }

    return stubPath;
  } catch (error) {
    logger.error(
      `${LOG_PREFIX_MDX_LOADER} Failed to create stub for: ${modulePath}`,
      error,
    );
    return null;
  }
}
