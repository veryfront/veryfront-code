/**
 * Validated path-cache lookups for MDX ESM module fetching.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/path-cache-lookup
 */

import type { Logger } from "#veryfront/utils";
import { getLocalFs } from "../cache/index.ts";
import { validateCachedModule } from "./framework-validator.ts";
import { recordModuleToSession } from "./render-sessions.ts";

interface MdxRecoveryOptions {
  projectId: string;
  contentSourceId: string;
}

export interface ReadValidCachedModulePathInput {
  normalizedPath: string;
  pathCache: Map<string, string>;
  versionedKey: string;
  log: Logger;
  recoveryOptions?: MdxRecoveryOptions;
}

/**
 * Return a cached module path only when the path-cache entry points to an
 * existing file whose contents pass the full cached-module validator.
 */
export async function readValidCachedModulePath(
  input: ReadValidCachedModulePathInput,
): Promise<string | null> {
  const cachedPath = input.pathCache.get(input.versionedKey);
  if (!cachedPath) return null;

  try {
    const stat = await getLocalFs().stat(cachedPath);
    if (!stat?.isFile) {
      // The cached path exists but is no longer a regular file (e.g. replaced
      // by a directory). Drop the stale entry so we don't re-stat it on every
      // future lookup.
      input.pathCache.delete(input.versionedKey);
      return null;
    }

    const cachedCode = await getLocalFs().readTextFile(cachedPath);
    if (
      await validateCachedModule(
        input.normalizedPath,
        cachedPath,
        cachedCode,
        input.log,
        input.pathCache,
        input.versionedKey,
        input.recoveryOptions,
      )
    ) {
      recordModuleToSession(input.normalizedPath);
      return cachedPath;
    }
  } catch (_) {
    /* expected: cached file may no longer exist on disk */
    input.pathCache.delete(input.versionedKey);
  }

  return null;
}
