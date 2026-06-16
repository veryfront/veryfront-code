/**
 * VF module resolver for SSR transformed code.
 *
 * Extracts and resolves /_vf_modules/* imports into file:// cache paths.
 */

import { join } from "#veryfront/compat/path/index.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { rendererLogger } from "#veryfront/utils";
import { getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { parseImports, replaceSpecifiers } from "#veryfront/transforms/esm/lexer.ts";
import {
  createModuleFetcherContext,
  fetchAndCacheModule,
} from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/index.ts";

const logger = rendererLogger.component("ssr-module-loader");

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
  const parsedImports = await parseImports(code);

  for (const importSpecifier of parsedImports) {
    const rawPath = importSpecifier.n;
    if (!rawPath) continue;

    // Normalize "file:///_vf_modules/..." and "/_vf_modules/..." to "_vf_modules/..."
    const path = rawPath.replace(/^(?:file:\/\/)?\/+/, "");
    if (!path.startsWith("_vf_modules/")) continue;

    const queryStart = path.indexOf("?");
    imports.push({
      specifier: rawPath,
      path: queryStart === -1 ? path : path.slice(0, queryStart),
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
    file: options.filePath.slice(-40),
    count: imports.length,
    paths: imports.map((i) => i.path).slice(0, 5),
  });

  const baseCacheDir = getMdxEsmCacheDir();
  const projectKey = hashCodeHex(options.projectId);
  const esmCacheDir = join(baseCacheDir, projectKey, options.contentSourceId);

  const fetcherContext = createModuleFetcherContext(
    esmCacheDir,
    options.adapter,
    options.projectDir,
    options.projectId,
    {
      contentSourceId: options.contentSourceId,
      reactVersion: options.reactVersion,
      projectSlug: options.projectId,
      strictMissingModules: false,
    },
  );

  const results = await Promise.all(
    imports.map(async ({ specifier, path }) => {
      try {
        const cachedFilePath = await fetchAndCacheModule(path, fetcherContext);
        return { specifier, path, cachedFilePath };
      } catch (error) {
        logger.warn("Failed to fetch _vf_modules import", {
          file: options.filePath.slice(-40),
          path,
          error: error instanceof Error ? error.message : String(error),
        });
        return { specifier, path, cachedFilePath: null };
      }
    }),
  );

  const replacements = new Map<string, string>();
  for (const { specifier, path, cachedFilePath } of results) {
    if (cachedFilePath) {
      replacements.set(specifier, `file://${cachedFilePath}`);
    } else {
      logger.warn("Failed to resolve _vf_modules import", {
        file: options.filePath.slice(-40),
        path,
      });
    }
  }

  if (replacements.size === 0) return code;
  return await replaceSpecifiers(code, (specifier) => replacements.get(specifier) ?? null);
}
