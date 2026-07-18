/**
 * Cache lookup phase for the SSR module loader.
 *
 * @module rendering/orchestrator/module-loader/module-cache-lookup
 */

import { join } from "#veryfront/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import {
  type CacheLookupResult,
  lookupMdxEsmCache,
} from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import { getMdxEsmCacheDir } from "#veryfront/utils/cache-dir.ts";
import { rendererLogger } from "#veryfront/utils";
import { REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { UNRESOLVED_VF_MODULES_RE } from "./module-transform-cache.ts";

const logger = rendererLogger.component("module-loader");

export function getModuleCacheKey(
  filePath: string,
  projectId?: string,
  projectDir?: string,
  contentSourceId?: string,
  reactVersion?: string,
  mode?: "development" | "production",
): string {
  const base = projectId ?? projectDir ?? "default";
  const source = contentSourceId ?? "default";
  return JSON.stringify([
    base,
    source,
    reactVersion ?? REACT_DEFAULT_VERSION,
    mode ?? "default",
    filePath,
  ]);
}

type LookupMdxCache = typeof lookupMdxEsmCache;
type FileSystemReader = Pick<ReturnType<typeof createFileSystem>, "readTextFile">;

export interface ResolveCachedModulePathInput {
  cacheKey: string;
  filePath: string;
  projectDir: string;
  projectId?: string;
  contentSourceId?: string;
  reactVersion?: string;
  moduleCache: Map<string, string>;
  readTextFile?: (path: string) => Promise<string>;
  fileSystem?: FileSystemReader;
  lookupMdxCache?: LookupMdxCache;
}

async function resolveInMemoryCachedPath(
  input: Pick<
    ResolveCachedModulePathInput,
    "cacheKey" | "filePath" | "moduleCache" | "readTextFile" | "fileSystem"
  >,
): Promise<string | undefined> {
  const cachedPath = input.moduleCache.get(input.cacheKey);
  if (!cachedPath) return undefined;

  try {
    const fileSystem = input.fileSystem ?? createFileSystem();
    const readTextFile = input.readTextFile ??
      ((path: string) => fileSystem.readTextFile(path));
    const cachedCode = await readTextFile(cachedPath);
    if (!UNRESOLVED_VF_MODULES_RE.test(cachedCode)) return cachedPath;

    logger.warn(
      "[ModuleLoader] In-memory cache contains unresolved _vf_modules, invalidating",
      {
        filePath: input.filePath.slice(-60),
        cachedPath: cachedPath.slice(-60),
      },
    );
  } catch (_) {
    /* expected: cached file may no longer exist on disk */
  }

  input.moduleCache.delete(input.cacheKey);
  return undefined;
}

async function resolveMdxEsmCachedPath(
  input: ResolveCachedModulePathInput,
): Promise<string | undefined> {
  if (!input.projectId || !input.contentSourceId) return undefined;

  const baseCacheDir = getMdxEsmCacheDir();
  const projectKey = encodeURIComponent(input.projectId);
  const sourceKey = encodeURIComponent(input.contentSourceId);
  const mdxCacheDir = join(baseCacheDir, projectKey, sourceKey);
  const lookup = input.lookupMdxCache ?? lookupMdxEsmCache;

  const mdxCacheResult: CacheLookupResult = await lookup(
    input.filePath,
    mdxCacheDir,
    input.projectDir,
    undefined,
    {
      projectId: input.projectId,
      contentSourceId: input.contentSourceId,
    },
    input.reactVersion,
  );

  if (mdxCacheResult.status === "hit") {
    input.moduleCache.set(input.cacheKey, mdxCacheResult.path);
    return mdxCacheResult.path;
  }

  if (mdxCacheResult.status === "corrupted") {
    logger.warn("MDX-ESM cache corrupted, will re-transform", {
      filePath: input.filePath,
      reason: mdxCacheResult.reason,
    });
  }

  return undefined;
}

export async function resolveCachedModulePath(
  input: ResolveCachedModulePathInput,
): Promise<string | undefined> {
  const inMemoryPath = await resolveInMemoryCachedPath(input);
  if (inMemoryPath) return inMemoryPath;

  return await resolveMdxEsmCachedPath(input);
}
