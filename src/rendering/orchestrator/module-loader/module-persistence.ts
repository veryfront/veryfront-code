/**
 * Final module-loader persistence phase.
 *
 * @module rendering/orchestrator/module-loader/module-persistence
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { rendererLogger } from "#veryfront/utils";
import { isCacheWriteRaceError } from "#veryfront/utils/cache-file-ops.ts";
import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";
import {
  getModulePathCache,
  saveModulePathCache,
} from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import { buildMdxEsmPathCacheKey } from "#veryfront/transforms/mdx/esm-module-loader/cache-format.ts";

const logger = rendererLogger.component("module-loader");

/** Maximum number of directories to track to prevent memory leaks. */
const MAX_CREATED_DIRS = 5_000;

/** Cache for created directories to avoid repeated mkdir calls (LRU-style). */
const createdDirs = new Set<string>();

/** Prune oldest entries when cache exceeds limit. */
function pruneCreatedDirs(): void {
  if (createdDirs.size <= MAX_CREATED_DIRS) return;

  const toDelete = createdDirs.size - MAX_CREATED_DIRS;
  let deleted = 0;

  for (const dir of createdDirs) {
    if (deleted >= toDelete) break;
    createdDirs.delete(dir);
    deleted++;
  }
}

async function ensureDir(
  adapter: RuntimeAdapter,
  dir: string,
  force = false,
): Promise<void> {
  if (!force && createdDirs.has(dir)) return;

  try {
    await adapter.fs.mkdir(dir, { recursive: true });
  } catch (error) {
    // `recursive: true` is a no-op on an existing directory, so a rejection here
    // means the directory may genuinely be absent (EMFILE, EACCES, a racing
    // sweep). Drop the memo so the next attempt retries instead of assuming the
    // directory is present forever after.
    createdDirs.delete(dir);
    throw error;
  }

  createdDirs.add(dir);
  pruneCreatedDirs();
}

export interface PersistTransformedModuleInput {
  filePath: string;
  projectDir: string;
  tmpDir: string;
  transformedCode: string;
  localAdapter: RuntimeAdapter;
  moduleCache: Map<string, string>;
  cacheKey: string;
  contentSourceId?: string;
  reactVersion?: string;
}

/** Write a transformed module artifact and register cache pointers. */
export async function persistTransformedModule(
  input: PersistTransformedModuleInput,
): Promise<string> {
  const transformedHash = hashCodeHex(input.transformedCode).slice(0, 8);

  const relativePath = input.filePath.startsWith(input.projectDir)
    ? input.filePath.slice(input.projectDir.length).replace(/^\/+/, "")
    : input.filePath.replace(/^\/+/, "");

  const jsPath = relativePath.replace(/\.(tsx?|jsx|mdx)$/, `.${transformedHash}.js`);
  const tempFilePath = join(input.tmpDir, jsPath);

  const tempDir = tempFilePath.substring(0, tempFilePath.lastIndexOf("/"));
  await ensureDir(input.localAdapter, tempDir).catch(() => {
    // Fall through to the write, which retries the mkdir on failure.
  });

  try {
    await input.localAdapter.fs.writeFile(tempFilePath, input.transformedCode);
  } catch (error) {
    // The cache directory can vanish between mkdir and write — a manual
    // `rm -rf .cache`, a cache sweep, or a mkdir that never actually landed.
    // Force the directory back into existence and retry once before failing.
    if (!isCacheWriteRaceError(error)) {
      logger.error("Failed to write module:", {
        filePath: input.filePath,
        tempFilePath,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    try {
      await ensureDir(input.localAdapter, tempDir, true);
      await input.localAdapter.fs.writeFile(tempFilePath, input.transformedCode);
      logger.debug("Recreated module cache directory after failed write", { tempDir });
    } catch (retryError) {
      logger.error("Failed to write module:", {
        filePath: input.filePath,
        tempFilePath,
        error: retryError instanceof Error ? retryError.message : String(retryError),
      });
      throw retryError;
    }
  }

  if (input.contentSourceId) {
    const normalizedPath = `_vf_modules/${relativePath.replace(/\.(tsx?|jsx|mdx)$/, ".js")}`;
    const mdxCacheKey = buildMdxEsmPathCacheKey(normalizedPath, input.reactVersion);
    const cache = await getModulePathCache(input.tmpDir);
    cache.set(mdxCacheKey, tempFilePath);

    saveModulePathCache(input.tmpDir).catch((err) => {
      logger.debug("Failed to save module cache", { error: String(err) });
    });

    logger.debug("Registered module in MDX-ESM cache", {
      file: input.filePath.slice(-40),
      mdxCacheKey,
      tempFilePath: tempFilePath.slice(-60),
    });
  }

  input.moduleCache.set(input.cacheKey, tempFilePath);
  return tempFilePath;
}
