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
import { writeCacheFile } from "#veryfront/utils/cache-file-ops.ts";
import { errorLogName, fileLogLabel } from "../../shared/log-context.ts";

/**
 * Validate and patch a cached JSX module in-place.
 *
 * Returns true if the cached module is usable, false if it should be re-generated.
 */
export async function ensureCachedJsxModulePatched(
  transformedPath: string,
  sourceFilePath: string,
): Promise<boolean> {
  const fs = getLocalFs();

  try {
    const cachedCode = await fs.readTextFile(transformedPath);
    const rewritten = await rewriteDntImports(cachedCode, sourceFilePath);

    if (rewritten === cachedCode) return true;

    const written = await writeCacheFile(fs, transformedPath, rewritten, "MDX-JSX-CACHE");
    if (!written) return false;
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Rewrote cached JSX dnt imports`, {
      sourceFile: fileLogLabel(sourceFilePath),
      cacheFile: fileLogLabel(transformedPath),
    });

    return true;
  } catch (error) {
    logger.debug(`${LOG_PREFIX_MDX_LOADER} Failed to read cached JSX module`, {
      sourceFile: fileLogLabel(sourceFilePath),
      cacheFile: fileLogLabel(transformedPath),
      errorName: errorLogName(error),
    });
    return false;
  }
}
