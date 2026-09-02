/**
 * Cached JSX module normalization utilities.
 *
 * Ensures cached JSX modules don't contain relative _dnt.* imports that break
 * when the file is moved into the MDX cache directory.
 */

import { rendererLogger as logger } from "#veryfront/utils";
import { LOG_PREFIX_MDX_LOADER } from "./constants.ts";
import { getLocalFs } from "./cache/index.ts";
import { rewriteDntImports } from "./module-fetcher/index.ts";

/** Bound on the cached-module paths this process remembers as normalized. */
const MAX_NORMALIZED_MODULE_MEMO_ENTRIES = 4096;

/**
 * Cached JSX module paths already known to be free of relative _dnt imports.
 *
 * A cache file name is derived from the source path and its full contents, so a
 * remembered path can never later describe different source. Without this, every
 * cache hit re-read and re-scanned the whole cached module, which let repeated
 * public requests for the same page pay that cost again on each render.
 */
const normalizedModulePaths = new Set<string>();

function rememberNormalizedModule(transformedPath: string): void {
  if (normalizedModulePaths.size >= MAX_NORMALIZED_MODULE_MEMO_ENTRIES) {
    normalizedModulePaths.clear();
  }
  normalizedModulePaths.add(transformedPath);
}

/**
 * Validate and patch a cached JSX module in-place.
 *
 * Returns true if the cached module is usable, false if it should be re-generated.
 */
export async function ensureCachedJsxModulePatched(
  transformedPath: string,
  sourceFilePath: string,
): Promise<boolean> {
  if (normalizedModulePaths.has(transformedPath)) return true;

  const fs = getLocalFs();

  try {
    const cachedCode = await fs.readTextFile(transformedPath);
    const rewritten = await rewriteDntImports(cachedCode, sourceFilePath);

    if (rewritten === cachedCode) {
      rememberNormalizedModule(transformedPath);
      return true;
    }

    await fs.writeTextFile(transformedPath, rewritten);
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Rewrote cached JSX dnt imports`, {
      sourceFilePath,
      transformedPath,
    });

    rememberNormalizedModule(transformedPath);
    return true;
  } catch (error) {
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Failed to read cached JSX module`, {
      sourceFilePath,
      transformedPath,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
