/**
 * Final module-loader persistence phase.
 *
 * @module rendering/orchestrator/module-loader/module-persistence
 */

import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { dirname, isAbsolute, join, relative } from "#veryfront/compat/path/index.ts";
import { rendererLogger } from "#veryfront/utils";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import {
  getModulePathCache,
  saveModulePathCache,
} from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import { buildMdxEsmPathCacheKey } from "#veryfront/transforms/mdx/esm-module-loader/cache-format.ts";

const logger = rendererLogger.component("module-loader");

async function ensureDir(adapter: RuntimeAdapter, dir: string): Promise<void> {
  await adapter.fs.mkdir(dir, { recursive: true });
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
  const transformedHash = (await computeHash(input.transformedCode)).slice(0, 16);

  const relativePath = relative(input.projectDir, input.filePath).replaceAll("\\", "/");
  if (
    !relativePath || relativePath === ".." || relativePath.startsWith("../") ||
    isAbsolute(relativePath)
  ) {
    throw new TypeError("Transformed module source path is outside the project");
  }

  // These files are imported directly as native ESM. Use an explicit ESM
  // extension so the bounded path cache can reject executable CommonJS files
  // without also rejecting artifacts produced by this loader.
  const lastSlash = relativePath.lastIndexOf("/");
  const lastDot = relativePath.lastIndexOf(".");
  const pathWithoutExtension = lastDot > lastSlash ? relativePath.slice(0, lastDot) : relativePath;
  const jsPath = `${pathWithoutExtension}.${transformedHash}.mjs`;
  const tempFilePath = join(input.tmpDir, jsPath);

  const tempDir = dirname(tempFilePath);
  await ensureDir(input.localAdapter, tempDir);

  try {
    await input.localAdapter.fs.writeFile(tempFilePath, input.transformedCode);
  } catch (error) {
    logger.error("Failed to write module:", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    throw error;
  }

  if (input.contentSourceId) {
    const normalizedPath = `_vf_modules/${relativePath.replace(/\.(tsx?|jsx|mdx)$/, ".js")}`;
    const mdxCacheKey = buildMdxEsmPathCacheKey(normalizedPath, input.reactVersion);
    const cache = await getModulePathCache(input.tmpDir);
    cache.set(mdxCacheKey, tempFilePath);

    await saveModulePathCache(input.tmpDir);

    logger.debug("Registered module in MDX-ESM cache");
  }

  input.moduleCache.set(input.cacheKey, tempFilePath);
  return tempFilePath;
}
