import {
  extractCacheKeyContext,
  tryGetCacheKeyContext,
} from "#veryfront/cache/cache-key-builder.ts";
import { SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE } from "#veryfront/errors";
import type { HandlerContext } from "../types.ts";

function hasMutablePreviewSource(ctx: HandlerContext): boolean {
  if (!ctx.projectSlug) return false;
  const cacheContext = tryGetCacheKeyContext() ?? extractCacheKeyContext(ctx);
  // Skip immutable production source and indeterminate identity.
  return !!cacheContext && cacheContext.mode !== "production";
}

interface SourceSnapshotFreshnessReasons {
  readonly ensure: string;
  readonly refreshFallback: string;
}

const DEFAULT_FRESHNESS_REASONS: SourceSnapshotFreshnessReasons = Object.freeze({
  ensure: "preview-request-routing",
  refreshFallback: "preview-api-route-discovery",
});

/**
 * Establish the current mutable source snapshot before request routing or
 * rendering reads project files.
 *
 * Throws when the source can go stale and the adapter offers no way to bring
 * it up to date. Treating that as success is what lets an older snapshot reach
 * hydration, so the request fails instead.
 */
export async function ensurePreviewSourceSnapshotFresh(
  ctx: HandlerContext,
  reasons: SourceSnapshotFreshnessReasons = DEFAULT_FRESHNESS_REASONS,
): Promise<void> {
  if (!hasMutablePreviewSource(ctx)) return;
  const fs = ctx.adapter.fs;
  if (fs.ensureSourceSnapshotFresh) {
    await fs.ensureSourceSnapshotFresh(reasons.ensure);
    return;
  }

  // Backward compatibility for custom remote adapters that only implement the
  // original unconditional refresh contract.
  if (fs.refreshSourceSnapshot) {
    await refreshPreviewSourceSnapshot(ctx, reasons.refreshFallback);
    return;
  }

  // All three source snapshot methods are optional, and an adapter declares a
  // snapshot by implementing any of them. Local filesystem adapters (deno,
  // node, bun) implement none: every read already returns the current bytes,
  // so there is no generation to establish and the request proceeds.
  if (typeof fs.getSourceSnapshotVersion !== "function") return;

  // The adapter has a snapshot that can fall behind and no way to advance it.
  // Returning here would render an older snapshot that hydration then replaces,
  // so fail the request instead.
  throw SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE.create({
    detail:
      `The filesystem adapter serving "${ctx.projectSlug}" exposes a source snapshot version but implements neither ensureSourceSnapshotFresh() nor refreshSourceSnapshot(), so this request cannot confirm it is rendering the current source.`,
  });
}

export async function refreshPreviewSourceSnapshot(
  ctx: HandlerContext,
  reason = "preview-api-route-discovery",
): Promise<void> {
  if (!hasMutablePreviewSource(ctx)) return;
  await ctx.adapter.fs.refreshSourceSnapshot?.(reason);
}
