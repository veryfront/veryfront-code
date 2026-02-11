/**
 * VF module resolver for SSR transformed code.
 *
 * Extracts and resolves /_vf_modules/* imports into file:// cache paths.
 */

import { join } from "#veryfront/compat/path/index.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { rendererLogger } from "#veryfront/utils";
import { getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import {
  createModuleFetcherContext,
  fetchAndCacheModule,
} from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/index.ts";
import { VF_MODULE_IMPORT_PATTERN } from "#veryfront/transforms/mdx/esm-module-loader/constants.ts";

const logger = rendererLogger.component("ssr-module-loader");

interface VfModuleImport {
  original: string;
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
export function findVfModuleImports(code: string): VfModuleImport[] {
  const imports: VfModuleImport[] = [];
  const pattern = new RegExp(VF_MODULE_IMPORT_PATTERN.source, "g");

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    const rawPath = match[1];
    if (!rawPath) continue;

    // Normalize "file:///_vf_modules/..." and "/_vf_modules/..." to "_vf_modules/..."
    const path = rawPath.replace(/^(?:file:\/\/)?\/+/, "");
    imports.push({ original: match[0], path });
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
  const imports = findVfModuleImports(code);
  if (imports.length === 0) return code;

  logger.debug("Processing _vf_modules imports", {
    file: options.filePath.slice(-40),
    count: imports.length,
    paths: imports.map((i) => i.path).slice(0, 5),
  });

  const baseCacheDir = getMdxEsmCacheDir();
  const projectKey = encodeURIComponent(options.projectId);
  const esmCacheDir = join(baseCacheDir, projectKey, options.contentSourceId);

  const fetcherContext = createModuleFetcherContext(
    esmCacheDir,
    options.adapter,
    options.projectDir,
    options.projectId,
    {
      reactVersion: options.reactVersion,
      projectSlug: options.projectId,
      strictMissingModules: false,
    },
  );

  const results = await Promise.all(
    imports.map(async ({ original, path }) => {
      const cachedFilePath = await fetchAndCacheModule(path, fetcherContext);
      return { original, path, cachedFilePath };
    }),
  );

  let transformed = code;
  for (const { original, path, cachedFilePath } of results) {
    if (cachedFilePath) {
      transformed = transformed.replace(original, `from "file://${cachedFilePath}"`);
    } else {
      logger.warn("Failed to resolve _vf_modules import", {
        file: options.filePath.slice(-40),
        path,
      });
    }
  }

  return transformed;
}
