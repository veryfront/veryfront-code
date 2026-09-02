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
import { registerCache } from "#veryfront/utils/memory/index.ts";
import {
  collectCssImportPaths,
  CSS_IMPORTING_SOURCE_EXTENSIONS,
} from "#veryfront/html/styles-builder/css-import-extraction.ts";
import { resolveStyleContentVersion } from "#veryfront/html/styles-builder/content-version.ts";
import {
  createStyleScopeProfile,
  shouldIncludeStylePath,
  shouldTraverseStyleDirectory,
} from "#veryfront/html/styles-builder/style-scope-profile.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import type { ResolvedContentContext } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import type { HandlerContext } from "../types.ts";

const logger = serverLogger.component("styles-css-import-scanner");

interface SourceFileProvider {
  getAllSourceFiles?: () =>
    | Array<{ path: string; content?: string }>
    | Promise<Array<{ path: string; content?: string }>>;
  getContentContext?: () => ResolvedContentContext | null;
}

/**
 * How long a scan of mutable content (a branch preview or a local project,
 * whose sources change without producing a new content version) may be reused.
 * Matches the candidate manifest's development-mode TTL so both pre-cache
 * scanners of this route refresh on the same cadence.
 */
const MUTABLE_SCAN_TTL_MS = 2_000;
const SCAN_CACHE_MAX_ENTRIES = 200;

interface CssImportScanEntry {
  imports: string[];
  builtAt: number;
}

/**
 * Memoized scan results keyed by project scope, content version and style
 * profile. The stylesheet route this scanner serves is public and the scan runs
 * before the prepared-CSS cache lookup, so without memoization every
 * unauthenticated request forces an O(project source size) walk even when the
 * stylesheet would have been served straight from cache.
 */
const scanCache = new Map<string, CssImportScanEntry>();

/** Coalesces concurrent scans for the same key into a single source walk. */
const inFlightScans = new Map<string, Promise<string[]>>();

registerCache("styles-css-import-scans", () => ({
  name: "styles-css-import-scans",
  entries: scanCache.size,
  maxEntries: SCAN_CACHE_MAX_ENTRIES,
}));

interface ScanCacheIdentity {
  key: string;
  /**
   * Whether the content behind this key can change without changing the key.
   * `live` (local project) and `branch:` versions do; release and environment
   * versions name an immutable content snapshot.
   */
  mutable: boolean;
}

function resolveContentContext(ctx: HandlerContext): ResolvedContentContext | null {
  const wrappedFs = ctx.adapter.fs as { getUnderlyingAdapter?: () => unknown };
  if (typeof wrappedFs.getUnderlyingAdapter !== "function") return null;

  const fsAdapter = wrappedFs.getUnderlyingAdapter() as SourceFileProvider;
  return typeof fsAdapter.getContentContext === "function" ? fsAdapter.getContentContext() : null;
}

function resolveScanCacheIdentity(ctx: HandlerContext): ScanCacheIdentity {
  const contentContext = resolveContentContext(ctx);
  const projectScope = ctx.projectSlug ?? contentContext?.projectSlug ?? ctx.projectDir;
  const projectVersion = resolveStyleContentVersion(contentContext, {
    releaseId: ctx.releaseId,
    branch: ctx.parsedDomain?.branch,
    environmentName: ctx.environmentName,
  });
  const styleProfile = createStyleScopeProfile(ctx.config);

  return {
    key: `${projectScope}:${projectVersion}:${styleProfile.hash}`,
    mutable: projectVersion === "live" || projectVersion.startsWith("branch:"),
  };
}

function readFreshScan(identity: ScanCacheIdentity): string[] | undefined {
  const entry = scanCache.get(identity.key);
  if (!entry) return undefined;
  if (identity.mutable && (Date.now() - entry.builtAt) > MUTABLE_SCAN_TTL_MS) return undefined;
  return entry.imports;
}

/** Invalidate cached CSS import scans for one project scope (or all scopes). */
export function invalidateProjectCssImportScans(projectScope?: string): void {
  if (!projectScope) {
    scanCache.clear();
    return;
  }

  for (const key of scanCache.keys()) {
    if (key.startsWith(`${projectScope}:`)) scanCache.delete(key);
  }
}

/**
 * Scan project source files for CSS imports and return the resolved absolute
 * paths, deduplicated. Mirrors the file coverage of the Tailwind candidate
 * scanner: the FS adapter's `getAllSourceFiles()` in proxy/remote mode, and a
 * recursive local walk otherwise.
 *
 * Results are memoized per (project scope, content version, style profile) and
 * concurrent scans for the same key are coalesced into one walk. Both matter
 * for availability rather than speed: `/_vf_styles/styles.css` is public and
 * exempt from the runtime's concurrency limiter, so an unmemoized scan lets an
 * unauthenticated client force an unbounded number of full source walks on a
 * shared preview runtime.
 */
export async function extractProjectCssImports(ctx: HandlerContext): Promise<string[]> {
  const identity = resolveScanCacheIdentity(ctx);

  const cached = readFreshScan(identity);
  if (cached) return [...cached];

  const inFlight = inFlightScans.get(identity.key);
  if (inFlight) return [...await inFlight];

  const scan = scanProjectCssImports(ctx, identity.key);
  inFlightScans.set(identity.key, scan);
  try {
    return [...await scan];
  } finally {
    inFlightScans.delete(identity.key);
  }
}

async function scanProjectCssImports(ctx: HandlerContext, cacheKey: string): Promise<string[]> {
  const files = await collectSourceFiles(ctx);
  const cssImports = collectCssImportPaths(files, ctx.projectDir);

  if (cssImports.length > 0) {
    logger.debug("Discovered module CSS imports", {
      projectDir: ctx.projectDir,
      count: cssImports.length,
    });
  }

  if (scanCache.size >= SCAN_CACHE_MAX_ENTRIES && !scanCache.has(cacheKey)) {
    const oldestKey = scanCache.keys().next().value as string | undefined;
    if (oldestKey) scanCache.delete(oldestKey);
  }
  scanCache.set(cacheKey, { imports: cssImports, builtAt: Date.now() });

  return cssImports;
}

async function collectSourceFiles(
  ctx: HandlerContext,
): Promise<Array<{ path: string; content: string }>> {
  const wrappedFs = ctx.adapter.fs as { getUnderlyingAdapter?: () => unknown };
  const fsAdapter = typeof wrappedFs.getUnderlyingAdapter === "function"
    ? wrappedFs.getUnderlyingAdapter() as SourceFileProvider
    : undefined;

  if (typeof fsAdapter?.getAllSourceFiles === "function") {
    const files = await fsAdapter.getAllSourceFiles();
    const collected: Array<{ path: string; content: string }> = [];

    for (const file of files) {
      if (!CSS_IMPORTING_SOURCE_EXTENSIONS.some((ext) => file.path.endsWith(ext))) continue;
      const absolutePath = file.path.startsWith("/")
        ? normalizePath(file.path)
        : normalizePath(join(ctx.projectDir, file.path));
      const content = file.content ?? await readFileOrNull(ctx, absolutePath);
      if (content === null) continue;
      collected.push({ path: absolutePath, content });
    }

    return collected;
  }

  return scanLocalSourceFiles(ctx);
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
): Promise<Array<{ path: string; content: string }>> {
  const styleProfile = createStyleScopeProfile(ctx.config);
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
