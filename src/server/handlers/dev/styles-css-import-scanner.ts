/**
 * Styles CSS Import Scanner
 *
 * Discovers CSS files imported by project source modules (side-effect imports
 * like `import "./styles.css"` in app/layout.tsx, `@/` alias imports, and CSS
 * module imports). The production SSR pipeline collects these imports while
 * loading modules and merges them into the page stylesheet; the page-agnostic
 * /_vf_styles/styles.css dev route has no module-loading pass, so this scanner
 * recovers the same information from project sources using the shared
 * css-import-extraction helpers.
 *
 * @module server/handlers/dev/styles-css-import-scanner
 */

import { serverLogger } from "#veryfront/utils";
import { normalizePath } from "#veryfront/utils/path-utils.ts";
import {
  collectCssImportPaths,
  CSS_IMPORTING_SOURCE_EXTENSIONS,
} from "#veryfront/html/styles-builder/css-import-extraction.ts";
import {
  shouldIncludeStylePath,
  shouldTraverseStyleDirectory,
} from "#veryfront/html/styles-builder/style-scope-profile.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import {
  createProjectScanCache,
  resolveScanCacheIdentity,
  type ScanCacheIdentity,
} from "./styles-scan-cache.ts";
import type { HandlerContext } from "../types.ts";

const logger = serverLogger.component("styles-css-import-scanner");

interface SourceFileProvider {
  getAllSourceFiles?: (options?: { waitForWarmup?: boolean }) =>
    | Array<{ path: string; content?: string }>
    | Promise<Array<{ path: string; content?: string }>>;
}

const importScanCache = createProjectScanCache("styles-css-import-scans");

/**
 * Invalidate cached CSS import scans for one project scope (or all scopes).
 *
 * The scope is the resolved content slug for content-backed and proxy-admitted
 * requests, which is what `clearProjectCSSCache` passes on a content push. A
 * content-less, non-proxy scan (a local `veryfront dev` server) is scoped by
 * `ctx.projectDir` instead, and `clearProjectCSSCache` is wired only for the
 * control-plane filesystem adapter, so the dev server pokes that scope itself
 * from its HMR invalidation subscription. The mutable TTL remains the backstop
 * for a scope no poke reaches.
 */
export function invalidateProjectCssImportScans(projectScope?: string): void {
  importScanCache.invalidate(projectScope);
}

/**
 * Scan project source files for CSS imports and return the resolved absolute
 * paths, deduplicated. Mirrors the file coverage of the Tailwind candidate
 * scanner: the FS adapter's `getAllSourceFiles()` in proxy/remote mode, and a
 * recursive local walk otherwise.
 *
 * Results are memoized per (content scope, content version, style profile) and
 * concurrent scans for the same key are coalesced into one walk. Both matter
 * for availability rather than speed: `/_vf_styles/styles.css` is public and
 * exempt from the runtime's concurrency limiter, so an unmemoized scan lets an
 * unauthenticated client force an unbounded number of full source walks on a
 * shared preview runtime.
 */
export function extractProjectCssImports(ctx: HandlerContext): Promise<string[]> {
  const identity = resolveScanCacheIdentity(ctx);
  return importScanCache.run(
    identity,
    (_canCache, skipCache) => scanProjectCssImports(ctx, identity, skipCache),
  );
}

async function scanProjectCssImports(
  ctx: HandlerContext,
  identity: ScanCacheIdentity,
  skipCache: () => void,
): Promise<string[]> {
  const files = await collectSourceFiles(ctx, identity, skipCache);
  const cssImports = collectCssImportPaths(files, ctx.projectDir);

  if (cssImports.length > 0) {
    logger.debug("Discovered module CSS imports", {
      projectDir: ctx.projectDir,
      count: cssImports.length,
    });
  }

  return cssImports;
}

async function collectSourceFiles(
  ctx: HandlerContext,
  identity: ScanCacheIdentity,
  skipCache: () => void,
): Promise<Array<{ path: string; content: string }>> {
  const wrappedFs = ctx.adapter.fs as { getUnderlyingAdapter?: () => unknown };
  const fsAdapter = typeof wrappedFs.getUnderlyingAdapter === "function"
    ? wrappedFs.getUnderlyingAdapter() as SourceFileProvider
    : undefined;

  if (typeof fsAdapter?.getAllSourceFiles === "function") {
    const files = await fsAdapter.getAllSourceFiles({ waitForWarmup: !identity.mutable });
    if (!identity.mutable && files.length === 0) skipCache();
    const collected: Array<{ path: string; content: string }> = [];

    for (const file of files) {
      if (!CSS_IMPORTING_SOURCE_EXTENSIONS.some((ext) => file.path.endsWith(ext))) continue;
      const absolutePath = file.path.startsWith("/")
        ? normalizePath(file.path)
        : normalizePath(join(ctx.projectDir, file.path));
      const content = file.content ?? await readFileOrNull(ctx, absolutePath);
      if (content === null) {
        skipCache();
        continue;
      }
      collected.push({ path: absolutePath, content });
    }

    return collected;
  }

  return scanLocalSourceFiles(ctx, identity);
}

async function readFileOrNull(ctx: HandlerContext, path: string): Promise<string | null> {
  try {
    return await ctx.adapter.fs.readFile(path);
  } catch (_) {
    /* expected: skip files that can't be read */
    return null;
  }
}

/** Fallback for local development mode: walk the project directory on disk. */
async function scanLocalSourceFiles(
  ctx: HandlerContext,
  identity: ScanCacheIdentity,
): Promise<Array<{ path: string; content: string }>> {
  const styleProfile = identity.styleProfile;
  const fs = createFileSystem();
  const collected: Array<{ path: string; content: string }> = [];

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
        if (shouldTraverseStyleDirectory(styleProfile, fullPath, ctx.projectDir)) {
          await scanDir(fullPath);
        }
        continue;
      }

      if (!entry.isFile) continue;
      if (!shouldIncludeStylePath(styleProfile, fullPath, ctx.projectDir)) continue;
      if (!CSS_IMPORTING_SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;

      const content = await readFileOrNull(ctx, fullPath);
      if (content === null) continue;
      collected.push({ path: normalizePath(fullPath), content });
    }
  };

  try {
    await scanDir(ctx.projectDir);
  } catch (error) {
    logger.warn("Failed to scan local files for CSS imports", {
      projectDir: ctx.projectDir,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return collected;
}
