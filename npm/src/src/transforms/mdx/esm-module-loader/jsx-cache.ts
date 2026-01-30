/**
 * Cached JSX module normalization utilities.
 *
 * Ensures cached JSX modules don't contain relative _dnt.* imports that break
 * when the file is moved into the MDX cache directory.
 */

import { rendererLogger as logger } from "../../../utils/index.js";
import { LOG_PREFIX_MDX_LOADER } from "./constants.js";
import { getLocalFs } from "./cache/index.js";
import { rewriteDntImports } from "./module-fetcher/index.js";

/**
 * Validate and patch a cached JSX module in-place.
 *
 * Returns true if the cached module is usable, false if it should be re-generated.
 */
export async function ensureCachedJsxModulePatched(
  transformedPath: string,
  sourceFilePath: string,
): Promise<boolean> {
  try {
    const cachedCode = await getLocalFs().readTextFile(transformedPath);
    const rewritten = rewriteDntImports(cachedCode, sourceFilePath);
    if (rewritten !== cachedCode) {
      await getLocalFs().writeTextFile(transformedPath, rewritten);
      logger.debug(`${LOG_PREFIX_MDX_LOADER} Rewrote cached JSX dnt imports`, {
        sourceFilePath,
        transformedPath,
      });
    }
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
