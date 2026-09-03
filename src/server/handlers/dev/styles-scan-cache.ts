/**
 * Styles Scan Cache
 *
 * Shared memoization for the source-tree walks that `/_vf_styles/styles.css`
 * performs before it can consult its prepared-CSS cache: the module CSS import
 * scan and the Tailwind candidate scan. Both iterate every project source file
 * (and read each one that arrives without content), the route is public
 * (`AuthHandler` continues when the project has no auth config), and it is
 * listed in `LIGHTWEIGHT_PATH_PREFIXES`, so it also bypasses the runtime's
 * concurrency limiter. Without memoization an unauthenticated client can force
 * an unbounded number of parallel `O(project source bytes)` walks.
 *
 * @module server/handlers/dev/styles-scan-cache
 */

import { registerCache } from "#veryfront/utils/memory/index.ts";
import { resolveStyleContentVersion } from "#veryfront/html/styles-builder/content-version.ts";
import {
  createStyleScopeProfile,
  type StyleScopeProfile,
} from "#veryfront/html/styles-builder/style-scope-profile.ts";
import type { ResolvedContentContext } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import type { HandlerContext } from "../types.ts";

/**
 * How long a scan of mutable content (a local project, a branch preview or a
 * named environment, whose sources change without producing a new content
 * version) may be reused. Matches the candidate manifest's development-mode
 * TTL, and bounds how long a missed invalidation poke can serve stale results.
 */
const MUTABLE_SCAN_TTL_MS = 2_000;
const SCAN_CACHE_MAX_ENTRIES = 200;

export interface ScanCacheIdentity {
  key: string;
  /** Project scope used to target invalidation at one project's entries. */
  scope: string;
  /** Resolved content version this scan reads, shared with the candidate manifest. */
  version: string;
  /**
   * Whether the content behind this key can change without changing the key.
   * Only `release:` versions name a frozen content snapshot; `live` (a local
   * project), `branch:` and `environment:` versions are moving pointers whose
   * contents change under a stable name, so they get the mutable TTL and
   * self-heal even if an invalidation poke is missed.
   */
  mutable: boolean;
  /** Style scope profile for this request, hashed into the key. */
  styleProfile: StyleScopeProfile;
}

interface ContentContextProvider {
  getContentContext?: () => ResolvedContentContext | null;
}

/** The content context the filesystem resolves for itself, when it exposes one. */
function resolveScanContentContext(ctx: HandlerContext): ResolvedContentContext | null {
  const wrappedFs = ctx.adapter.fs as { getUnderlyingAdapter?: () => unknown };
  if (typeof wrappedFs.getUnderlyingAdapter !== "function") return null;

  const fsAdapter = wrappedFs.getUnderlyingAdapter() as ContentContextProvider;
  return typeof fsAdapter.getContentContext === "function" ? fsAdapter.getContentContext() : null;
}

/**
 * Fallback content selectors for a proxy filesystem that resolves no content
 * context of its own (`MultiProjectFSAdapter` exposes `getAllSourceFiles()`
 * but no `getContentContext()`). The key must name the source tree the walk
 * actually reads, so these mirror the selector precedence and environment
 * gating that `withProxyContext` / `MultiProjectFSAdapter.runWithContext`
 * apply when selecting the per-request filesystem:
 *
 * - A release pins content only for a production-resolved request.
 *   `runWithContext` nulls `releaseId` outside production mode, so a preview
 *   request that happens to carry one still serves mutable branch content --
 *   keying it `release:<id>` would freeze that content under an immutable key.
 * - `withProxyContext` derives the branch from `ctx.requestContext?.branch ??
 *   ctx.parsedDomain?.branch` and nothing else, and ignores branches entirely
 *   in production mode. Reading any other branch field here would key two
 *   requests that the filesystem serves from different trees onto one entry.
 */
function proxyContentVersionFallback(ctx: HandlerContext): {
  releaseId: string | null;
  branch: string | null;
  environmentName: string | null;
} {
  const productionMode = (ctx.resolvedEnvironment ?? ctx.requestContext?.mode) === "production";
  return {
    releaseId: productionMode ? ctx.releaseId ?? null : null,
    branch: productionMode ? null : ctx.requestContext?.branch ?? ctx.parsedDomain?.branch ?? null,
    environmentName: ctx.environmentName ?? null,
  };
}

/**
 * Resolve the cache identity for the source tree this request is about to walk.
 */
export function resolveScanCacheIdentity(ctx: HandlerContext): ScanCacheIdentity {
  const contentContext = resolveScanContentContext(ctx);
  const styleProfile = createStyleScopeProfile(ctx.config);

  // The cache key names the source tree that is actually about to be walked, so
  // it is derived only from resolved identity: the filesystem's own content
  // context when available, otherwise the project and snapshot admitted by the
  // shared proxy. A local or standalone filesystem serves `ctx.projectDir`
  // whatever the client claims, so its untrusted selectors never enter the key.
  //
  // `ctx.projectSlug` is required here rather than only as the invalidation
  // scope: in shared proxy mode the underlying `MultiProjectFSAdapter` exposes
  // `getAllSourceFiles()` but no `getContentContext()`, and it resolves a
  // different per-tenant filesystem from the admitted request context while
  // every tenant keeps the same server-level `ctx.projectDir`. Keying on
  // `projectDir` alone would collapse all of them onto one entry, so a request
  // for project B could reuse or join project A's walk and then persist A's
  // results into B's prepared stylesheet. Behind the proxy admission boundary
  // the slug is resolved tenant identity, so it is safe to key on there -- but
  // ONLY there. Outside proxy mode `ctx.projectSlug` is a client-supplied
  // selector (the raw `x-project-slug` header or the Host-parsed subdomain,
  // with no trust gate), while the filesystem serves `ctx.projectDir` whatever
  // the client claims. Folding it into the key on a standalone server would let
  // an unauthenticated caller mint a fresh key per request and force one full
  // source walk each time, so a content-less non-proxy scan keys on the
  // directory that is actually walked.
  const contentScope = contentContext?.projectSlug ??
    (ctx.isProxyMode ? ctx.projectSlug : undefined) ??
    ctx.projectDir;
  const projectVersion = resolveStyleContentVersion(
    contentContext,
    ctx.isProxyMode ? proxyContentVersionFallback(ctx) : {},
  );

  return {
    key: `${contentScope}\u0000${projectVersion}\u0000${styleProfile.hash}`,
    // The stored invalidation scope resolves with the same precedence as the
    // key's content scope above: a content push invalidates by the resolved
    // content slug, so a scope derived any other way could leave a
    // release-versioned entry that a targeted invalidation never matches.
    scope: contentScope,
    version: projectVersion,
    mutable: !projectVersion.startsWith("release:"),
    styleProfile,
  };
}

interface ScanEntry {
  /** Project scope this entry belongs to, for targeted invalidation. */
  scope: string;
  results: string[];
  builtAt: number;
}

interface PendingScan {
  scope: string;
  generation: string;
  promise: Promise<string[]>;
}

export interface ProjectScanCache {
  /** Memoized scan for `identity`; `scan` runs only on a miss. */
  run(identity: ScanCacheIdentity, scan: () => Promise<string[]>): Promise<string[]>;
  /** Invalidate cached scans for one project scope (or all scopes). */
  invalidate(projectScope?: string): void;
}

/**
 * Create a bounded, single-flight memo for one kind of project source walk.
 *
 * Each memo owns its own entries and invalidation generations; `name` is the
 * label it registers with the memory profiler.
 */
export function createProjectScanCache(name: string): ProjectScanCache {
  const scanCache = new Map<string, ScanEntry>();

  /** Coalesces concurrent scans for the same key into a single source walk. */
  const inFlightScans = new Map<string, PendingScan>();
  const pendingScanCounts = new Map<string, number>();

  /**
   * Invalidation generations. A scan that started before its scope's current
   * generation read a source snapshot that has since been declared stale, so it
   * may neither publish its result into the cache nor be joined by later
   * requests -- otherwise a content push landing mid-walk is silently undone.
   *
   * The counter is per project scope because `invalidate` is itself scoped: one
   * tenant's content push must not retire another tenant's in-flight walk on a
   * shared preview runtime, which would force that tenant to re-walk and
   * partially defeat the memoization this cache exists to provide. An unscoped
   * invalidation bumps `globalGeneration`, which retires every scope at once
   * without having to enumerate them.
   */
  let globalGeneration = 0;
  const scopeGenerations = new Map<string, number>();

  registerCache(name, () => ({
    name,
    entries: scanCache.size,
    maxEntries: SCAN_CACHE_MAX_ENTRIES,
  }));

  /** Generation token for one scope: the global epoch plus that scope's bumps. */
  function generationFor(scope: string): string {
    return `${globalGeneration}\u0000${scopeGenerations.get(scope) ?? 0}`;
  }

  /** Drop a scope's counter once nothing cached or in flight still refers to it. */
  function pruneScopeGeneration(scope: string): void {
    for (const entry of scanCache.values()) if (entry.scope === scope) return;
    if ((pendingScanCounts.get(scope) ?? 0) > 0) return;
    scopeGenerations.delete(scope);
  }

  function beginPendingScan(scope: string): void {
    pendingScanCounts.set(scope, (pendingScanCounts.get(scope) ?? 0) + 1);
  }

  function finishPendingScan(scope: string): void {
    const remaining = (pendingScanCounts.get(scope) ?? 1) - 1;
    if (remaining > 0) {
      pendingScanCounts.set(scope, remaining);
    } else {
      pendingScanCounts.delete(scope);
    }
    pruneScopeGeneration(scope);
  }

  function readFreshScan(identity: ScanCacheIdentity): string[] | undefined {
    const entry = scanCache.get(identity.key);
    if (!entry) return undefined;
    if (identity.mutable && (Date.now() - entry.builtAt) > MUTABLE_SCAN_TTL_MS) return undefined;

    // Reinsert so eviction is by least-recent use rather than by insertion
    // order: `Map.set` on an existing key keeps its original position, so
    // without this the hottest long-lived entries would be evicted first
    // simply because they were cached first, exactly under the sustained load
    // this memo exists to absorb.
    scanCache.delete(identity.key);
    scanCache.set(identity.key, entry);
    return entry.results;
  }

  function storeScan(identity: ScanCacheIdentity, results: string[], generation: string): void {
    // An invalidation that landed while this walk was reading the previous
    // source snapshot has already dropped this key; publishing the snapshot now
    // would undo it, and for a release version nothing would ever refresh it.
    if (generation !== generationFor(identity.scope)) return;

    scanCache.delete(identity.key);
    if (scanCache.size >= SCAN_CACHE_MAX_ENTRIES) {
      const leastRecentKey = scanCache.keys().next().value as string | undefined;
      if (leastRecentKey) scanCache.delete(leastRecentKey);
    }
    scanCache.set(identity.key, { scope: identity.scope, results, builtAt: Date.now() });
  }

  return {
    async run(identity, scan) {
      const cached = readFreshScan(identity);
      if (cached) return [...cached];

      // Only join a walk that started at the current generation: one that
      // predates an invalidation is reading a snapshot already known to be
      // stale.
      const generation = generationFor(identity.scope);
      const inFlight = inFlightScans.get(identity.key);
      if (inFlight?.generation === generation) return [...await inFlight.promise];

      beginPendingScan(identity.scope);
      const pending: PendingScan = {
        scope: identity.scope,
        generation,
        // A failed walk is never cached, so the next request retries it.
        promise: (async () => {
          const results = await scan();
          storeScan(identity, results, generation);
          return results;
        })(),
      };
      inFlightScans.set(identity.key, pending);
      try {
        return [...await pending.promise];
      } finally {
        if (inFlightScans.get(identity.key) === pending) inFlightScans.delete(identity.key);
        finishPendingScan(identity.scope);
      }
    },

    invalidate(projectScope) {
      // Bumping the generation retires the scans already reading sources for
      // the invalidated scope, so a walk that started before this call can
      // neither repopulate the entry it just dropped nor be joined by a request
      // that arrives after it. Scans for every other scope keep their
      // generation and stay joinable -- this project's push says nothing about
      // their sources.
      if (!projectScope) {
        globalGeneration++;
        scopeGenerations.clear();
        scanCache.clear();
        return;
      }

      scopeGenerations.set(projectScope, (scopeGenerations.get(projectScope) ?? 0) + 1);

      for (const [key, entry] of scanCache) {
        if (entry.scope === projectScope) scanCache.delete(key);
      }

      pruneScopeGeneration(projectScope);
    },
  };
}
