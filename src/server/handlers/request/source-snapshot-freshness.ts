import {
  extractCacheKeyContext,
  tryGetCacheKeyContext,
} from "#veryfront/cache/cache-key-builder.ts";
import { SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE } from "#veryfront/errors";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { readOwnDataProperty } from "#veryfront/security/project-locality.ts";
import type { HandlerContext, HandlerResult } from "../types.ts";

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

export type PreviewDocumentSnapshotReclassifier = () => Promise<HandlerResult>;

export interface PreviewSourceSnapshotMarker {
  readonly identity: string;
  readonly version?: number;
}

interface PreparedDocumentSnapshot {
  readonly identity?: string;
  readonly version?: number;
  readonly reclassify?: PreviewDocumentSnapshotReclassifier;
  readonly configBound?: boolean;
}

const preparedDocumentSnapshots = new WeakMap<HandlerContext, PreparedDocumentSnapshot>();

/** Capture a stable, reusable identity for the adapter snapshot. */
export async function capturePreviewSourceSnapshotMarker(
  fs: FileSystemAdapter,
): Promise<PreviewSourceSnapshotMarker | undefined> {
  const identity = await fs.getSourceSnapshotIdentity?.();
  if (identity === undefined) return;
  const version = await fs.getSourceSnapshotVersion?.();
  // A reused contextual adapter can switch branches across either await. Only
  // publish a marker when both observations name the same source context.
  if (await fs.getSourceSnapshotIdentity?.() !== identity) return;
  return { identity, version };
}

/** Bind already-derived request configuration to its strict source snapshot. */
export function seedPreviewDocumentSourceSnapshot(
  ctx: HandlerContext,
  marker: PreviewSourceSnapshotMarker,
): void {
  preparedDocumentSnapshots.set(ctx, { ...marker, configBound: true });
}

function throwConfigSnapshotChanged(ctx: HandlerContext): never {
  throw SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE.create({
    detail:
      `The mutable source snapshot serving "${ctx.projectSlug}" changed after request configuration was derived, so this document request must be retried against one generation.`,
  });
}

async function preparedDocumentSnapshotMatches(
  ctx: HandlerContext,
  prepared: PreparedDocumentSnapshot,
): Promise<boolean> {
  const identity = await ctx.adapter.fs.getSourceSnapshotIdentity?.();
  const version = await ctx.adapter.fs.getSourceSnapshotVersion?.();
  const identityMatches = prepared.identity !== undefined && identity === prepared.identity;
  const versionMatches = prepared.version === undefined || version === prepared.version;
  return identityMatches && versionMatches;
}

/** Establish strict freshness before API/page ownership is classified. */
export async function preparePreviewDocumentSourceSnapshot(
  ctx: HandlerContext,
  reclassify?: PreviewDocumentSnapshotReclassifier,
): Promise<void> {
  const configSnapshot = preparedDocumentSnapshots.get(ctx);
  if (configSnapshot?.configBound === true) {
    if (!(await preparedDocumentSnapshotMatches(ctx, configSnapshot))) {
      throwConfigSnapshotChanged(ctx);
    }
    preparedDocumentSnapshots.set(ctx, { ...configSnapshot, reclassify });
    return;
  }

  await ensurePreviewSourceSnapshotFresh(ctx, DOCUMENT_FRESHNESS_REASONS);
  // The classifier runs before SSR enters its render context, and SSR may
  // still change a reused contextual adapter's context (setRequestBranch)
  // before it reads. Record which snapshot identity this preparation applied
  // to; reuse is sound only while the render context resolves the same one.
  // An adapter that cannot name its context records an unprovable preparation,
  // so the render re-establishes freshness (or reclassifies) instead of trusting
  // a possibly different context.
  const identity = await ctx.adapter.fs.getSourceSnapshotIdentity?.();
  const version = await ctx.adapter.fs.getSourceSnapshotVersion?.();
  preparedDocumentSnapshots.set(ctx, { identity, version, reclassify });
}

/**
 * Return the prepared classifier only when its page/API decision has become
 * stale. This probe never refreshes an unprepared direct SSR request, which
 * lets memory-pressure shedding stay cheap without hiding a newly API-owned
 * route behind an SSR 503.
 */
export async function reclassifyPreviewDocumentSourceSnapshotIfChanged(
  ctx: HandlerContext,
): Promise<PreviewDocumentSnapshotReclassifier | undefined> {
  const prepared = preparedDocumentSnapshots.get(ctx);
  if (prepared?.reclassify === undefined) return;
  if (await preparedDocumentSnapshotMatches(ctx, prepared)) return;
  if (prepared.configBound === true) throwConfigSnapshotChanged(ctx);
  preparedDocumentSnapshots.delete(ctx);
  return prepared.reclassify;
}

/**
 * Reuse a strict snapshot prepared by the API/page classifier, or return the
 * continuation that can classify the current generation again.
 */
export async function ensurePreviewDocumentSourceSnapshot(
  ctx: HandlerContext,
): Promise<PreviewDocumentSnapshotReclassifier | undefined> {
  const prepared = preparedDocumentSnapshots.get(ctx);
  if (prepared !== undefined) {
    preparedDocumentSnapshots.delete(ctx);
    // Freshness established by the classifier only carries over when this
    // render context still targets the identity the preparation refreshed. A
    // branch switch on a reused contextual adapter between the two points
    // must re-establish, or the render serves the previous branch's snapshot.
    if (await preparedDocumentSnapshotMatches(ctx, prepared)) return;
    if (prepared.configBound === true) throwConfigSnapshotChanged(ctx);

    // A same-branch source replacement preserves identity but increments the
    // generation. Refreshing here would make SSR read the new files while
    // retaining the previous generation's page/API decision. Let the original
    // classifier rerun in the render's established adapter context instead.
    if (prepared.reclassify !== undefined) return prepared.reclassify;
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
  await ensureMutablePreviewSourceSnapshotFresh(ctx.adapter.fs, ctx.projectSlug!, reasons);
}

async function ensureMutablePreviewSourceSnapshotFresh(
  fs: FileSystemAdapter,
  projectSlug: string,
  reasons: SourceSnapshotFreshnessReasons,
): Promise<void> {
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
      await fs.refreshSourceSnapshot(reasons.refreshFallback);
      return;
    }
    // An ensure-only adapter must explicitly advertise the options contract.
    // Function arity is not a capability signal: optional/default parameters
    // and wrappers make it ambiguous, and guessing here can render stale HTML.
    throw SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE.create({
      detail:
        `The filesystem adapter serving "${projectSlug}" implements ensureSourceSnapshotFresh() but does not advertise sourceSnapshotFreshnessOptionsVersion: 1, so this document render cannot prove zero-age source freshness.`,
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
    await fs.refreshSourceSnapshot(reasons.refreshFallback);
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
      `The filesystem adapter serving "${projectSlug}" exposes a source snapshot version but implements neither ensureSourceSnapshotFresh() nor refreshSourceSnapshot(), so this request cannot confirm it is rendering the current source.`,
  });
}

/** Establish zero-age freshness before loading preview document configuration. */
export async function ensurePreviewDocumentConfigSourceSnapshotFresh(
  fs: FileSystemAdapter,
  projectSlug: string,
): Promise<void> {
  await ensureMutablePreviewSourceSnapshotFresh(fs, projectSlug, DOCUMENT_FRESHNESS_REASONS);
}

export async function refreshPreviewSourceSnapshot(
  ctx: HandlerContext,
  reason = "preview-api-route-discovery",
): Promise<void> {
  if (!hasMutablePreviewSource(ctx)) return;
  await ctx.adapter.fs.refreshSourceSnapshot?.(reason);
}
