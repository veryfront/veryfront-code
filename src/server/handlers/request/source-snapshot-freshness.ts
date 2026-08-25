import {
  extractCacheKeyContext,
  tryGetCacheKeyContext,
} from "#veryfront/cache/cache-key-builder.ts";
import { SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE } from "#veryfront/errors";
import { readOwnDataProperty } from "#veryfront/security/project-locality.ts";
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
  /**
   * Oldest freshness check this caller accepts, in milliseconds. Omit to take
   * the adapter's default lease, which is what sub-resource requests inside one
   * page load want. A document render passes 0, because the snapshot it serves
   * is the one hydration compares against.
   */
  readonly maxAgeMs?: number;
}

const DEFAULT_FRESHNESS_REASONS: SourceSnapshotFreshnessReasons = Object.freeze({
  ensure: "preview-request-routing",
  refreshFallback: "preview-api-route-discovery",
});

const DOCUMENT_FRESHNESS_REASONS: SourceSnapshotFreshnessReasons = Object.freeze({
  ensure: "preview-document-routing",
  refreshFallback: "preview-document-routing",
  maxAgeMs: 0,
});

interface PreparedDocumentSnapshot {
  readonly identity: string;
  readonly version: number | undefined;
  readonly tracksVersion: boolean;
}

const documentFreshContexts = new WeakMap<HandlerContext, PreparedDocumentSnapshot>();

/** Establish strict freshness before API/page ownership is classified. */
export async function preparePreviewDocumentSourceSnapshot(ctx: HandlerContext): Promise<void> {
  await ensurePreviewSourceSnapshotFresh(ctx, DOCUMENT_FRESHNESS_REASONS);
  // The classifier runs before SSR enters its render context, and SSR may
  // still change a reused contextual adapter's context (setRequestBranch)
  // before it reads. Record which snapshot identity this preparation applied
  // to; reuse is sound only while the render context resolves the same one.
  // An adapter that cannot name its context records nothing, so the render
  // re-establishes freshness instead of trusting a possibly different context.
  const identity = await ctx.adapter.fs.getSourceSnapshotIdentity?.();
  if (identity !== undefined) {
    const getVersion = ctx.adapter.fs.getSourceSnapshotVersion;
    const tracksVersion = typeof getVersion === "function";
    const version = tracksVersion ? await getVersion.call(ctx.adapter.fs) : undefined;
    documentFreshContexts.set(ctx, { identity, version, tracksVersion });
  }
}

/** Reuse a strict snapshot prepared by the API/page classifier, or establish it directly. */
export async function ensurePreviewDocumentSourceSnapshot(ctx: HandlerContext): Promise<void> {
  const prepared = documentFreshContexts.get(ctx);
  if (prepared !== undefined) {
    documentFreshContexts.delete(ctx);
    // Freshness established by the classifier only carries over when this
    // render context still targets the identity the preparation refreshed. A
    // branch switch on a reused contextual adapter between the two points
    // must re-establish, or the render serves the previous branch's snapshot.
    const identity = await ctx.adapter.fs.getSourceSnapshotIdentity?.();
    const getVersion = ctx.adapter.fs.getSourceSnapshotVersion;
    const versionMatches = !prepared.tracksVersion ||
      (typeof getVersion === "function" &&
        await getVersion.call(ctx.adapter.fs) === prepared.version);
    if (identity === prepared.identity && versionMatches) return;
  }
  await ensurePreviewSourceSnapshotFresh(ctx, DOCUMENT_FRESHNESS_REASONS);
}

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
  const supportsFreshnessOptions = readOwnDataProperty(
    fs,
    "sourceSnapshotFreshnessOptionsVersion",
  ) === 1;
  if (
    reasons.maxAgeMs !== undefined && reasons.maxAgeMs <= 0 &&
    fs.ensureSourceSnapshotFresh &&
    !supportsFreshnessOptions
  ) {
    // Legacy custom adapters implemented the original one-argument method and
    // silently ignore freshness options. A document render cannot reuse that
    // lease, so fall back to unconditional refresh when it is available.
    if (fs.refreshSourceSnapshot) {
      await refreshPreviewSourceSnapshot(ctx, reasons.refreshFallback);
      return;
    }
    // An ensure-only adapter must explicitly advertise the options contract.
    // Function arity is not a capability signal: optional/default parameters
    // and wrappers make it ambiguous, and guessing here can render stale HTML.
    throw SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE.create({
      detail:
        `The filesystem adapter serving "${ctx.projectSlug}" implements ensureSourceSnapshotFresh() but does not advertise sourceSnapshotFreshnessOptionsVersion: 1, so this document render cannot prove zero-age source freshness.`,
    });
  }

  if (fs.ensureSourceSnapshotFresh) {
    await fs.ensureSourceSnapshotFresh(
      reasons.ensure,
      reasons.maxAgeMs === undefined ? undefined : { maxAgeMs: reasons.maxAgeMs },
    );
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
