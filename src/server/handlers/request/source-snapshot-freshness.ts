import {
  extractCacheKeyContext,
  tryGetCacheKeyContext,
} from "#veryfront/cache/cache-key-builder.ts";
import { SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE } from "#veryfront/errors";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { delay } from "#veryfront/platform/compat/std/async.ts";
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
  readonly identity?: string;
  readonly version?: number;
}

interface PreparedDocumentSnapshot {
  readonly identity?: string;
  readonly version?: number;
  readonly reclassify?: PreviewDocumentSnapshotReclassifier;
  readonly configBound?: boolean;
  readonly liveSource?: boolean;
  readonly fixedContext?: boolean;
}

const preparedDocumentSnapshots = new WeakMap<HandlerContext, PreparedDocumentSnapshot>();

/** Capture a stable, reusable identity for the adapter snapshot. */
export async function capturePreviewSourceSnapshotMarker(
  fs: FileSystemAdapter,
): Promise<PreviewSourceSnapshotMarker | undefined> {
  const hasIdentity = typeof fs.getSourceSnapshotIdentity === "function";
  const hasVersion = typeof fs.getSourceSnapshotVersion === "function";
  if (!hasIdentity && !hasVersion) return;
  const identity = await fs.getSourceSnapshotIdentity?.();
  const version = await fs.getSourceSnapshotVersion?.();
  // A reused contextual adapter can switch branches across either await. Only
  // publish a marker when both observations name the same source context.
  if (hasIdentity && await fs.getSourceSnapshotIdentity?.() !== identity) return;
  if (hasVersion && await fs.getSourceSnapshotVersion?.() !== version) return;
  if (identity === undefined && version === undefined) return;
  return {
    ...(identity === undefined ? {} : { identity }),
    ...(version === undefined ? {} : { version }),
  };
}

/**
 * Attempts to observe a settled generation before giving up.
 *
 * capturePreviewSourceSnapshotMarker() returns undefined when the generation
 * moves between its two observations. A project whose source is still being
 * written -- the first document request after project creation is the common
 * case -- can lose that race repeatedly while being perfectly healthy, and one
 * observation is not evidence the source is unreadable. Re-observing costs four
 * adapter reads and is side-effect free, so a bounded retry converts the
 * dominant transient failure into a slightly slower success.
 *
 * Bounded, not unbounded: a source that genuinely never settles must still fail
 * loudly rather than hold the request open.
 */
const REQUIRED_SNAPSHOT_MARKER_ATTEMPTS = 3;

/**
 * Backoff before re-observing. An attempt is four adapter reads, which against a
 * remote adapter already spans real time -- but against a cached or local one it
 * can resolve in microseconds, so three immediate attempts would give a writer no
 * chance to settle and the retry would buy nothing. Pacing the retries is what
 * makes them meaningful. Only the failing path pays it, and never before the
 * first attempt, so a settled source is unaffected.
 */
const REQUIRED_SNAPSHOT_MARKER_RETRY_DELAY_MS = 10;

export async function captureRequiredPreviewSourceSnapshotMarker(
  fs: FileSystemAdapter,
  projectSlug: string,
): Promise<PreviewSourceSnapshotMarker> {
  for (let attempt = 0; attempt < REQUIRED_SNAPSHOT_MARKER_ATTEMPTS; attempt++) {
    if (attempt > 0) await delay(attempt * REQUIRED_SNAPSHOT_MARKER_RETRY_DELAY_MS);
    const marker = await capturePreviewSourceSnapshotMarker(fs);
    if (marker?.identity !== undefined && marker.version !== undefined) return marker;
  }
  throw SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE.create({
    detail:
      `The filesystem adapter serving "${projectSlug}" cannot identify the strict source snapshot and concrete generation that produced preview document configuration.`,
  });
}

export function previewSourceSnapshotMarkersEqual(
  left: PreviewSourceSnapshotMarker,
  right: PreviewSourceSnapshotMarker,
): boolean {
  return left.identity === right.identity && left.version === right.version;
}

/** Bind already-derived request configuration to its strict source snapshot. */
export function seedPreviewDocumentSourceSnapshot(
  ctx: HandlerContext,
  marker: PreviewSourceSnapshotMarker,
): void {
  preparedDocumentSnapshots.set(ctx, { ...marker, configBound: true });
}

interface RetainedPreviewDocumentSourceSnapshotOptions<T> {
  /** Keep the validated marker available for a later request phase. */
  readonly retainAfterOperation?: (result: T) => boolean;
  /** Re-enter request context before deferred response-body work. */
  readonly runDeferredOperation?: <R>(operation: () => Promise<R>) => Promise<R>;
}

/**
 * Keep a config-bound marker alive across an upstream operation and validate
 * both sides of it. A downstream document handler may release its WeakMap
 * entry before returning through project middleware, so the retained value is
 * the authority for the final check.
 */
export async function runWithRetainedPreviewDocumentSourceSnapshot<T>(
  ctx: HandlerContext,
  operation: () => Promise<T>,
  options: RetainedPreviewDocumentSourceSnapshotOptions<T> = {},
): Promise<T> {
  const retained = preparedDocumentSnapshots.get(ctx);
  if (retained?.configBound === true) {
    if (!(await preparedDocumentSnapshotMatches(ctx, retained))) {
      throwConfigSnapshotChanged(ctx);
    }
  } else {
    const beforeOperation = await reclassifyPreviewDocumentSourceSnapshotIfChanged(ctx);
    if (beforeOperation !== undefined) throwSnapshotReclassificationRequired(ctx);
  }

  const validate = async (): Promise<void> => {
    if (
      retained?.configBound === true &&
      !(await preparedDocumentSnapshotMatches(ctx, retained))
    ) {
      throwConfigSnapshotChanged(ctx);
    }
    const afterOperation = await reclassifyPreviewDocumentSourceSnapshotIfChanged(ctx);
    if (afterOperation !== undefined) throwSnapshotReclassificationRequired(ctx);
  };
  let finalization: Promise<void> | undefined;
  const finalize = (): Promise<void> => {
    finalization ??= (async () => {
      try {
        await validate();
      } finally {
        preparedDocumentSnapshots.delete(ctx);
      }
    })();
    return finalization;
  };
  let finalizationTransferredToBody = false;
  let retentionContinues = false;
  let primaryFailure = false;
  try {
    const result = await operation();
    if (
      retained?.configBound === true &&
      !(await preparedDocumentSnapshotMatches(ctx, retained))
    ) {
      throwConfigSnapshotChanged(ctx);
    }
    if (options.retainAfterOperation?.(result) === true) {
      await validate();
      retentionContinues = true;
      return result;
    }
    if (
      result instanceof Response && result.body !== null &&
      (retained !== undefined || preparedDocumentSnapshots.has(ctx))
    ) {
      // A handler may prepare its marker during the operation. Validate it
      // before status and headers escape, then keep validating deferred bytes.
      await validate();
      const response = retainPreviewSnapshotThroughResponseBody(
        result,
        validate,
        finalize,
        options.runDeferredOperation,
      );
      finalizationTransferredToBody = true;
      return response as T;
    }
    await finalize();
    return result;
  } catch (error) {
    primaryFailure = true;
    throw error;
  } finally {
    if (!finalizationTransferredToBody && !retentionContinues) {
      if (primaryFailure) await finalizeAfterPrimaryFailure(finalize);
      else await finalize();
    }
  }
}

function retainPreviewSnapshotThroughResponseBody(
  response: Response,
  validate: () => Promise<void>,
  finalize: () => Promise<void>,
  runDeferredOperation: <T>(operation: () => Promise<T>) => Promise<T> = (operation) => operation(),
): Response {
  const reader = response.body!.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await runDeferredOperation(async () => {
        try {
          await validate();
          const chunk = await reader.read();
          if (!chunk.done) {
            await validate();
            controller.enqueue(chunk.value);
            return;
          }
          await finalize();
          controller.close();
        } catch (error) {
          await cancelReaderAfterPrimaryFailure(reader, error);
          await finalizeAfterPrimaryFailure(finalize);
          controller.error(error);
        }
      });
    },
    async cancel(reason) {
      await runDeferredOperation(async () => {
        let cancellationError: unknown;
        let cancellationFailed = false;
        try {
          await reader.cancel(reason);
        } catch (error) {
          cancellationFailed = true;
          cancellationError = error;
        }
        if (cancellationFailed) {
          await finalizeAfterPrimaryFailure(finalize);
          throw cancellationError;
        }
        await finalize();
      });
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function cancelReaderAfterPrimaryFailure(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: unknown,
): Promise<void> {
  try {
    await reader.cancel(reason);
  } catch {
    return;
  }
}

async function finalizeAfterPrimaryFailure(finalize: () => Promise<void>): Promise<void> {
  try {
    await finalize();
  } catch {
    return;
  }
}

function throwConfigSnapshotChanged(ctx: HandlerContext): never {
  throw SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE.create({
    detail:
      `The mutable source snapshot serving "${ctx.projectSlug}" changed after request configuration was derived, so this document request must be retried against one generation.`,
  });
}

function throwSnapshotReclassificationRequired(ctx: HandlerContext): never {
  throw SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE.create({
    detail:
      `The mutable source snapshot serving "${ctx.projectSlug}" changed during handler dispatch, so this request must be retried against one generation.`,
  });
}

async function preparedDocumentSnapshotMatches(
  ctx: HandlerContext,
  prepared: PreparedDocumentSnapshot,
): Promise<boolean> {
  if (prepared.liveSource === true && isLiveSourceWithoutSnapshotCapabilities(ctx.adapter.fs)) {
    return true;
  }
  const identity = await ctx.adapter.fs.getSourceSnapshotIdentity?.();
  const version = await ctx.adapter.fs.getSourceSnapshotVersion?.();
  const identityMatches = prepared.identity !== undefined
    ? identity === prepared.identity
    : prepared.fixedContext === true && prepared.version !== undefined;
  const versionMatches = prepared.version !== undefined && version === prepared.version;
  return identityMatches && versionMatches;
}

function hasFixedProjectContext(fs: FileSystemAdapter): boolean {
  if (readOwnDataProperty(fs, "projectContextSemantics") === "fixed") return true;
  return !isExtendedFSAdapter(fs) || fs.isFixedProjectMode?.() === true;
}

function throwUnidentifiablePreviewSnapshot(ctx: HandlerContext): never {
  throw SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE.create({
    detail:
      `The filesystem adapter serving "${ctx.projectSlug}" refreshed mutable preview source but cannot identify its snapshot generation.`,
  });
}

/** Establish strict freshness before API/page ownership is classified. */
export async function preparePreviewDocumentSourceSnapshot(
  ctx: HandlerContext,
  reclassify?: PreviewDocumentSnapshotReclassifier,
): Promise<void> {
  if (!hasMutablePreviewSource(ctx)) {
    preparedDocumentSnapshots.delete(ctx);
    return;
  }
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
  const liveSource = isLiveSourceWithoutSnapshotCapabilities(ctx.adapter.fs);
  if (identity === undefined && version === undefined && !liveSource) {
    preparedDocumentSnapshots.delete(ctx);
    throwUnidentifiablePreviewSnapshot(ctx);
  }
  const fixedContext = hasFixedProjectContext(ctx.adapter.fs);
  preparedDocumentSnapshots.set(ctx, {
    identity,
    version,
    reclassify,
    liveSource,
    fixedContext,
  });
}

function isLiveSourceWithoutSnapshotCapabilities(fs: FileSystemAdapter): boolean {
  return fs.refreshSourceSnapshot === undefined &&
    fs.ensureSourceSnapshotFresh === undefined &&
    fs.getSourceSnapshotVersion === undefined &&
    fs.getSourceSnapshotIdentity === undefined;
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
  if (prepared === undefined) return;
  if (await preparedDocumentSnapshotMatches(ctx, prepared)) return;
  if (prepared.configBound === true) throwConfigSnapshotChanged(ctx);
  preparedDocumentSnapshots.delete(ctx);
  if (prepared.reclassify === undefined) {
    throw SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE.create({
      detail:
        `The mutable source snapshot serving "${ctx.projectSlug}" changed during document rendering, so this request must be retried against one generation.`,
    });
  }
  return prepared.reclassify;
}

/** Validate and release the marker retained across one document render. */
export async function finishPreviewDocumentSourceSnapshot(
  ctx: HandlerContext,
): Promise<PreviewDocumentSnapshotReclassifier | undefined> {
  const reclassify = await reclassifyPreviewDocumentSourceSnapshotIfChanged(ctx);
  if (reclassify === undefined) preparedDocumentSnapshots.delete(ctx);
  return reclassify;
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
    // Freshness established by the classifier only carries over when this
    // render context still targets the identity the preparation refreshed. A
    // branch switch on a reused contextual adapter between the two points
    // must re-establish, or the render serves the previous branch's snapshot.
    if (await preparedDocumentSnapshotMatches(ctx, prepared)) return;
    preparedDocumentSnapshots.delete(ctx);
    if (prepared.configBound === true) throwConfigSnapshotChanged(ctx);

    // A same-branch source replacement preserves identity but increments the
    // generation. Refreshing here would make SSR read the new files while
    // retaining the previous generation's page/API decision. Let the original
    // classifier rerun in the render's established adapter context instead.
    if (prepared.reclassify !== undefined) return prepared.reclassify;
  }
  await ensurePreviewSourceSnapshotFresh(ctx, DOCUMENT_FRESHNESS_REASONS);
  const identity = await ctx.adapter.fs.getSourceSnapshotIdentity?.();
  const version = await ctx.adapter.fs.getSourceSnapshotVersion?.();
  const liveSource = isLiveSourceWithoutSnapshotCapabilities(ctx.adapter.fs);
  if (
    hasMutablePreviewSource(ctx) && (identity !== undefined || version !== undefined || liveSource)
  ) {
    preparedDocumentSnapshots.set(ctx, {
      identity,
      version,
      fixedContext: hasFixedProjectContext(ctx.adapter.fs),
      liveSource,
    });
  }
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
