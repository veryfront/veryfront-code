/**
 * Bundle dependency validation and recovery logic.
 *
 * Validates that all transitive dependencies of cached HTTP bundles exist locally,
 * recovering missing ones from distributed cache when possible.
 *
 * @module transforms/esm/bundle-deps-validator
 */

import { createFileSystem, exists } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { rendererLogger } from "#veryfront/utils";
import { httpBundleCache } from "./http-cache-wrapper.ts";
import { extractSourceUrl } from "./source-url-embed.ts";
import { ensureAbsoluteDir, hasIncompatibleFilePaths } from "./http-cache-helpers.ts";

const logger = rendererLogger.component("http-cache");

/**
 * Extract bundle deps (file:// paths or relative paths to http-{hash}.mjs) from code.
 * Handles both legacy absolute paths and new portable relative paths.
 */
export function extractBundleDeps(code: string): Array<{ path: string; hash: string }> {
  const deps: Array<{ path: string; hash: string }> = [];
  const seen = new Set<string>();

  // Match absolute file:// paths (legacy format)
  const absolutePattern = /file:\/\/([^"'\s]+veryfront-http-bundle\/http-(\d+)\.mjs)/gi;
  let match: RegExpExecArray | null;
  while ((match = absolutePattern.exec(code)) !== null) {
    const hash = match[2]!;
    if (seen.has(hash)) continue;
    seen.add(hash);
    deps.push({ path: match[1]!, hash });
  }

  // Match relative paths (new portable format): ./http-{hash}.mjs
  const relativePattern = /["']\.\/http-(\d+)\.mjs["']/gi;
  while ((match = relativePattern.exec(code)) !== null) {
    const hash = match[1]!;
    if (seen.has(hash)) continue;
    seen.add(hash);
    deps.push({ path: `http-${hash}.mjs`, hash });
  }

  return deps;
}

/**
 * Validate and recover all bundle dependencies (including transitive) to local disk.
 * Used before using Redis-cached bundles - if deps are missing and
 * unrecoverable, we should re-fetch from network instead of using the cache.
 */
export async function validateBundleDepsExist(
  deps: Array<{ path: string; hash: string }>,
  cacheDir: string,
): Promise<boolean> {
  const absoluteCacheDir = ensureAbsoluteDir(cacheDir);
  const fs = createFileSystem();

  const seen = new Set<string>();
  const pending = [...deps];

  while (pending.length > 0) {
    const batch = pending.splice(0, pending.length).filter((d) => !seen.has(d.hash));
    if (batch.length === 0) break;

    for (const { hash } of batch) seen.add(hash);

    const localChecks = await Promise.all(
      batch.map(async ({ hash }) => {
        try {
          return {
            hash,
            exists: await exists(join(absoluteCacheDir, `http-${hash}.mjs`)),
          };
        } catch {
          return { hash, exists: false };
        }
      }),
    );

    const missingDeps = localChecks.filter((c) => !c.exists);
    if (missingDeps.length === 0) {
      for (const { hash } of batch) {
        try {
          const code = await fs.readTextFile(join(absoluteCacheDir, `http-${hash}.mjs`));
          for (const dep of extractBundleDeps(code)) {
            if (!seen.has(dep.hash)) pending.push(dep);
          }
        } catch (_) {
          /* expected: cached bundle file may be unreadable */
        }
      }
      continue;
    }

    // Check if distributed cache is available
    const cacheAvailable = await httpBundleCache.isAvailable();
    if (!cacheAvailable) {
      logger.debug("Cannot validate deps - no distributed cache", {
        missing: missingDeps.map((d) => d.hash),
      });
      return false;
    }

    logger.debug("Recovering missing deps from Redis (batch)", {
      count: missingDeps.length,
      hashes: missingDeps.map((d) => d.hash),
    });

    const codes = await httpBundleCache.getBatchCodes(missingDeps.map((d) => d.hash));

    for (const { hash } of missingDeps) {
      const localCode = codes.get(hash);
      if (!localCode) {
        logger.debug("Dep cannot be recovered from Redis", { hash });
        return false;
      }

      const code = localCode as unknown as string;

      if (hasIncompatibleFilePaths(code, absoluteCacheDir)) {
        logger.debug("Dep has incompatible paths, rejecting cache", { hash });
        return false;
      }

      const canonicalPath = join(absoluteCacheDir, `http-${hash}.mjs`);
      try {
        await fs.mkdir(absoluteCacheDir, { recursive: true });
        await fs.writeTextFile(canonicalPath, code);
        logger.debug("Recovered dep from Redis", { hash });

        for (const dep of extractBundleDeps(code)) {
          if (!seen.has(dep.hash)) pending.push(dep);
        }
      } catch (error) {
        logger.error("Failed to write recovered dep", { hash, error });
        return false;
      }
    }
  }

  logger.debug("All deps recovered successfully", { count: seen.size });
  return true;
}

/**
 * Scan local cache for a bundle that imports the given hash and has an embedded source URL.
 * Used for last-resort recovery when URL mapping is missing from distributed cache.
 */
export async function findParentBundleWithEmbeddedUrl(
  targetHash: string,
  cacheDir: string,
  fs: ReturnType<typeof createFileSystem>,
): Promise<{ path: string; sourceUrl: string } | null> {
  try {
    const files = fs.readDir(cacheDir);
    const bundlePattern = /^http-(\d+)\.mjs$/;

    for await (const file of files) {
      if (!bundlePattern.test(file.name)) continue;

      const filePath = join(cacheDir, file.name);
      try {
        const content = await fs.readTextFile(filePath);

        const importsTarget = content.includes(`./http-${targetHash}.mjs`) ||
          content.includes(`http-${targetHash}.mjs"`);

        if (importsTarget) {
          const sourceUrl = extractSourceUrl(content);
          if (sourceUrl) {
            return { path: filePath, sourceUrl };
          }
        }
      } catch (_) {
        /* expected: individual bundle file may be unreadable */
        continue;
      }
    }
  } catch (error) {
    logger.debug("Error scanning for parent bundle", { targetHash, error });
  }

  return null;
}
