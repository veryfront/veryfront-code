import {
  extractCacheKeyContext,
  tryGetCacheKeyContext,
} from "#veryfront/cache/cache-key-builder.ts";
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
 */
export async function ensurePreviewSourceSnapshotFresh(
  ctx: HandlerContext,
  reasons: SourceSnapshotFreshnessReasons = DEFAULT_FRESHNESS_REASONS,
): Promise<void> {
  if (!hasMutablePreviewSource(ctx)) return;
  if (ctx.adapter.fs.ensureSourceSnapshotFresh) {
    await ctx.adapter.fs.ensureSourceSnapshotFresh(reasons.ensure);
    return;
  }

  // Backward compatibility for custom remote adapters that only implement the
  // original unconditional refresh contract.
  await refreshPreviewSourceSnapshot(ctx, reasons.refreshFallback);
}

export async function refreshPreviewSourceSnapshot(
  ctx: HandlerContext,
  reason = "preview-api-route-discovery",
): Promise<void> {
  if (!hasMutablePreviewSource(ctx)) return;
  await ctx.adapter.fs.refreshSourceSnapshot?.(reason);
}
