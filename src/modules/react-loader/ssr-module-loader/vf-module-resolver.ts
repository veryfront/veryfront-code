/**
 * VF module resolver for SSR transformed code.
 *
 * Extracts and resolves /_vf_modules/* imports into file:// cache paths.
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { rendererLogger } from "#veryfront/utils";
import { parseImports, replaceSpecifiers } from "#veryfront/transforms/esm/lexer.ts";
import { getMdxEsmSsrCacheDir } from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import {
  createModuleFetcherContext,
  fetchAndCacheModule,
} from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/index.ts";
import { DEPENDENCY_MISSING, INVALID_IMPORT } from "#veryfront/errors";
import { toFileUrl } from "#veryfront/compat/path/index.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const logger = rendererLogger.component("ssr-module-loader");
const MAX_VF_MODULE_IMPORTS = 5_000;
const MAX_VF_MODULE_SPECIFIER_LENGTH = 8_192;
const VF_MODULE_FETCH_BATCH_SIZE = 10;

function isValidVfModulePath(path: string): boolean {
  return path.length > "_vf_modules/".length &&
    path.length <= MAX_VF_MODULE_SPECIFIER_LENGTH &&
    !path.includes("\\") && !path.includes("%") &&
    !hasUnsafeControlCharacters(path) &&
    path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

interface VfModuleImport {
  specifier: string;
  path: string;
}

interface ResolveVfModuleImportsOptions {
  filePath: string;
  projectId: string;
  contentSourceId: string;
  adapter: RuntimeAdapter;
  projectDir: string;
  reactVersion?: string;
}

/**
 * Find /_vf_modules/ imports in transformed code.
 * Matches both /_vf_modules/... and file:///_vf_modules/... forms.
 */
export async function findVfModuleImports(code: string): Promise<VfModuleImport[]> {
  const imports: VfModuleImport[] = [];
  const seen = new Set<string>();
  const parsedImports = await parseImports(code);
  if (parsedImports.length > MAX_VF_MODULE_IMPORTS) {
    throw INVALID_IMPORT.create({
      detail: `Module exceeds the import limit of ${MAX_VF_MODULE_IMPORTS}`,
    });
  }

  for (const importSpecifier of parsedImports) {
    const rawPath = importSpecifier.n;
    if (
      !rawPath || rawPath.length > MAX_VF_MODULE_SPECIFIER_LENGTH ||
      hasUnsafeControlCharacters(rawPath)
    ) {
      continue;
    }

    // Normalize "file:///_vf_modules/..." and "/_vf_modules/..." to "_vf_modules/..."
    const path = rawPath.replace(/^(?:file:\/\/)?\/+/, "");
    if (!path.startsWith("_vf_modules/")) continue;

    const queryStart = path.indexOf("?");
    const modulePath = queryStart === -1 ? path : path.slice(0, queryStart);
    if (!isValidVfModulePath(modulePath) || seen.has(rawPath)) continue;
    seen.add(rawPath);
    imports.push({
      specifier: rawPath,
      path: modulePath,
    });
  }

  return imports;
}

/**
 * Resolve /_vf_modules/ imports to local cached modules and rewrite code.
 */
export async function resolveVfModuleImports(
  code: string,
  options: ResolveVfModuleImportsOptions,
): Promise<string> {
  const imports = await findVfModuleImports(code);
  if (imports.length === 0) return code;

  logger.debug("Processing _vf_modules imports", {
    count: imports.length,
  });

  const esmCacheDir = getMdxEsmSsrCacheDir(options.projectId, options.contentSourceId);

  const fetcherContext = createModuleFetcherContext(
    esmCacheDir,
    options.adapter,
    options.projectDir,
    options.projectId,
    {
      contentSourceId: options.contentSourceId,
      reactVersion: options.reactVersion,
      projectSlug: options.projectId,
      strictMissingModules: true,
    },
  );

  const results: Array<{ specifier: string; cachedFilePath: string | null }> = [];
  for (let index = 0; index < imports.length; index += VF_MODULE_FETCH_BATCH_SIZE) {
    const batch = imports.slice(index, index + VF_MODULE_FETCH_BATCH_SIZE);
    results.push(
      ...await Promise.all(
        batch.map(async ({ specifier, path }) => {
          try {
            const cachedFilePath = await fetchAndCacheModule(path, fetcherContext);
            return { specifier, cachedFilePath };
          } catch (error) {
            if (!(error instanceof Error) || error.name !== "MissingModuleError") {
              throw error;
            }
            logger.warn("Failed to fetch _vf_modules import", {
              errorName: error.name,
            });
            return { specifier, cachedFilePath: null };
          }
        }),
      ),
    );
  }

  const replacements = new Map<string, string>();
  let missingCount = 0;
  for (const { specifier, cachedFilePath } of results) {
    if (cachedFilePath) {
      replacements.set(specifier, toFileUrl(cachedFilePath).href);
    } else {
      missingCount++;
    }
  }

  if (missingCount > 0) {
    throw DEPENDENCY_MISSING.create({
      detail: `${missingCount} runtime module import${
        missingCount === 1 ? "" : "s"
      } could not be resolved`,
    });
  }
  return await replaceSpecifiers(code, (specifier) => replacements.get(specifier) ?? null);
}
