/**
 * Styles Candidate Scanner
 *
 * Extracts Tailwind CSS candidate class names from project source files.
 * Supports two strategies: FS adapter with getAllSourceFiles() for remote/proxy
 * mode, and local filesystem scanning as fallback for local development.
 *
 * @module server/handlers/dev/styles-candidate-scanner
 */

import { extractCandidates } from "#veryfront/html/styles-builder/tailwind-compiler.ts";
import {
  shouldIncludeStylePath,
  shouldTraverseStyleDirectory,
} from "#veryfront/html/styles-builder/style-scope-profile.ts";
import { serverLogger } from "#veryfront/utils";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { getProjectCandidates } from "#veryfront/rendering/orchestrator/css-candidate-manifest.ts";
import {
  createProjectScanCache,
  resolveScanCacheIdentity,
  type ScanCacheIdentity,
} from "./styles-scan-cache.ts";
import type { HandlerContext } from "../types.ts";
import { FRAMEWORK_CANDIDATES } from "./framework-candidates.generated.ts";

const logger = serverLogger.component("styles-candidate-scanner");

const SOURCE_EXTENSIONS = [".tsx", ".jsx", ".mdx", ".ts", ".js"];

/** De-duplicated set of framework candidates, computed once at import time. */
const frameworkCandidates = new Set<string>(FRAMEWORK_CANDIDATES);

interface SourceFileProvider {
  getAllSourceFiles?: (options?: { waitForWarmup?: boolean }) =>
    | Array<{ path: string; content?: string }>
    | Promise<Array<{ path: string; content?: string }>>;
}

const candidateScanCache = createProjectScanCache("styles-project-candidate-scans");

/**
 * Invalidate cached candidate scans for one project scope (or all scopes).
 *
 * Scope precedence matches `invalidateProjectCssImportScans`: the resolved
 * content slug for content-backed and proxy-admitted requests, and
 * `ctx.projectDir` for a content-less, non-proxy local server, which the dev
 * server pokes itself on every HMR invalidation because
 * `clearProjectCSSCache` is wired only for the control-plane filesystem
 * adapter.
 */
export function invalidateProjectCandidateScans(projectScope?: string): void {
  candidateScanCache.invalidate(projectScope);
}

/**
 * Extract Tailwind CSS candidate class names from all project source files.
 *
 * Tries the FS adapter's `getAllSourceFiles()` first (available in proxy/remote
 * mode). Falls back to recursive local directory scanning when no adapter or
 * method is available (local dev mode).
 *
 * The walk is memoized per (content scope, content version, style profile) and
 * concurrent scans for one key are coalesced into a single walk. The candidate
 * manifest downstream memoizes only the extraction, never the walk, so without
 * this an unauthenticated client could force one full source-tree walk per
 * request on the public `/_vf_styles/styles.css` route -- and in local mode a
 * full recursive disk walk that reads every source file.
 */
export async function extractProjectCandidates(ctx: HandlerContext): Promise<Set<string>> {
  const identity = resolveScanCacheIdentity(ctx);
  const projectCandidates = await candidateScanCache.run(
    identity,
    (canCache, skipCache) => scanProjectCandidates(ctx, identity, canCache, skipCache),
  );

  const candidates = new Set<string>(frameworkCandidates);
  for (const cls of projectCandidates) candidates.add(cls);
  return candidates;
}

/** Walk the project sources once and return the candidates they contribute. */
async function scanProjectCandidates(
  ctx: HandlerContext,
  identity: ScanCacheIdentity,
  canCache: () => boolean,
  skipCache: () => void,
): Promise<string[]> {
  const wrappedFs = ctx.adapter.fs as { getUnderlyingAdapter?: () => unknown };
  // Call getUnderlyingAdapter on wrappedFs to preserve its 'this' context.
  const fsAdapter = typeof wrappedFs.getUnderlyingAdapter === "function"
    ? wrappedFs.getUnderlyingAdapter() as SourceFileProvider
    : undefined;

  if (typeof fsAdapter?.getAllSourceFiles !== "function") {
    logger.debug(
      "[StylesCandidateScanner] No FS adapter source listing, falling back to local file scanning",
    );
    return scanLocalFiles(ctx, identity);
  }

  // Same warmup contract as the sibling CSS import scan: on a release-backed
  // cold start `getAllSourceFiles()` schedules a warmup and answers empty, and
  // nothing else populates that list. An empty result memoized under a
  // `release:` key is immutable, so the stylesheet would be served with
  // framework candidates only until an explicit `clearProjectCSSCache`. Wait
  // for the warmup exactly where the key is immutable; a mutable key self-heals
  // on the next request after the TTL, so it must not pay for the fetch.
  const files = await fsAdapter.getAllSourceFiles({ waitForWarmup: !identity.mutable });
  if (
    !identity.mutable &&
    (files.length === 0 ||
      files.some((file) =>
        SOURCE_EXTENSIONS.some((extension) => file.path.endsWith(extension)) &&
        file.content === undefined
      ))
  ) {
    skipCache();
  }

  return [...getProjectCandidates({
    // The manifest is keyed by the same resolved scope as the scan above, so a
    // client-supplied slug cannot mint manifest entries on a standalone server.
    // This is narrower than the slug-first scope that `clearProjectCSSCache`
    // pokes through `invalidateProjectCandidateManifests`: a content-less,
    // non-proxy request scopes its entries by `ctx.projectDir`, which that poke
    // does not match. Such a request always resolves the `live` version, so the
    // entry is built with `developmentMode: true` and the manifest's own TTL
    // retires it.
    projectScope: identity.scope,
    projectPartition: identity.partition,
    projectVersion: identity.version,
    projectDir: ctx.projectDir,
    styleProfile: identity.styleProfile,
    files,
    developmentMode: identity.mutable,
    shouldCache: canCache,
  })];
}

/**
 * Fallback: scan local files for Tailwind candidates when no FS adapter is available.
 * Used in local development mode where projects are read directly from disk.
 */
async function scanLocalFiles(
  ctx: HandlerContext,
  identity: ScanCacheIdentity,
): Promise<string[]> {
  const projectDir = ctx.projectDir;
  const styleProfile = identity.styleProfile;
  const candidates = new Set<string>();
  const fs = createFileSystem();

  const scanDir = async (dir: string): Promise<void> => {
    let entries: AsyncIterable<{ name: string; isDirectory: boolean; isFile: boolean }>;
    try {
      entries = fs.readDir(dir);
    } catch (_) {
      /* expected: directory may not exist */
      return;
    }

    for await (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory) {
        if (shouldTraverseStyleDirectory(styleProfile, fullPath, projectDir)) {
          await scanDir(fullPath);
        }
        continue;
      }

      if (!entry.isFile) continue;
      if (!shouldIncludeStylePath(styleProfile, fullPath, projectDir)) continue;
      if (!SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;

      try {
        const content = await ctx.adapter.fs.readFile(fullPath);
        for (const cls of extractCandidates(content)) candidates.add(cls);
      } catch (_) {
        /* expected: skip files that can't be read */
      }
    }
  };

  try {
    await scanDir(projectDir);
    logger.debug("Local file scan complete", {
      projectDir,
      candidates: candidates.size,
    });
  } catch (error) {
    logger.warn("Failed to scan local files", {
      projectDir,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return [...candidates];
}
