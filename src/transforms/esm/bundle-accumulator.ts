/**
 * Request-scoped HTTP bundle manifest accumulation.
 *
 * @module transforms/esm/bundle-accumulator
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { join, toFileUrl } from "#veryfront/compat/path/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import type { BundleEntry } from "./bundle-manifest-types.ts";
import { extractBundleDeps } from "./bundle-deps-validator.ts";
import { isDegradedArtifact } from "./degraded-artifact.ts";
import {
  isValidHttpBundleHash,
  MAX_HTTP_BUNDLE_GRAPH_ENTRIES,
  readCachedHttpBundleFile,
} from "./http-bundle-file.ts";
import { extractSourceUrl } from "./source-url-embed.ts";
import type { ModuleSourceCapture } from "./module-source-capture.ts";

export interface BundleAccumulator {
  readonly bundles: Map<string, BundleEntry>;
  complete: boolean;
  /** Optional caller-owned capture; never stored in a distributed manifest. */
  sourceCapture?: ModuleSourceCapture;
}

/** Per-request accumulator used by cacheHttpImportsToLocal. */
export const bundleAccumulatorStorage = new AsyncLocalStorage<BundleAccumulator>();

export function createBundleAccumulator(): BundleAccumulator {
  return { bundles: new Map(), complete: true };
}

/** Prevent a partial bundle set from being published as an atomic manifest. */
export function markBundleAccumulatorIncomplete(): void {
  const accumulator = bundleAccumulatorStorage.getStore();
  if (accumulator) accumulator.complete = false;
}

function recordBundle(entry: BundleEntry): void {
  const accumulator = bundleAccumulatorStorage.getStore();
  if (!accumulator) return;

  if (!isValidHttpBundleHash(entry.hash)) {
    accumulator.complete = false;
    return;
  }
  if (
    !accumulator.bundles.has(entry.hash) &&
    accumulator.bundles.size >= MAX_HTTP_BUNDLE_GRAPH_ENTRIES
  ) {
    accumulator.complete = false;
    return;
  }

  accumulator.bundles.set(entry.hash, entry);
}

/**
 * Record one freshly written bundle. Recursive network fetches record their own
 * artifacts, so this avoids trying to read a circular ancestor before its write
 * has completed.
 */
export async function trackWrittenBundle(
  hash: string,
  normalizedUrl: string,
  cachePath: string,
): Promise<boolean> {
  const accumulator = bundleAccumulatorStorage.getStore();
  if (!accumulator) return true;

  const bundle = await readCachedHttpBundleFile(createFileSystem(), cachePath);
  if (!bundle) {
    accumulator.complete = false;
    return false;
  }
  if (isDegradedArtifact(bundle.code)) {
    accumulator.complete = false;
    return true;
  }

  recordBundle({
    hash,
    url: normalizedUrl,
    sizeBytes: bundle.sizeBytes,
  });
  accumulator.sourceCapture?.record(toFileUrl(cachePath).href, bundle.code);
  return true;
}

/**
 * Record a complete, already-materialized bundle graph for memory, disk,
 * distributed-cache, and in-flight cache hits.
 */
export async function trackCachedBundleGraph(
  rootHash: string,
  rootUrl: string,
  rootPath: string,
  cacheDir: string,
): Promise<boolean> {
  const accumulator = bundleAccumulatorStorage.getStore();
  if (!accumulator) return true;

  const fs = createFileSystem();
  const pending = [{ hash: rootHash, path: rootPath, fallbackUrl: rootUrl }];
  const seen = new Set<string>();

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (seen.has(current.hash)) continue;
    if (
      !isValidHttpBundleHash(current.hash) ||
      seen.size >= MAX_HTTP_BUNDLE_GRAPH_ENTRIES
    ) {
      accumulator.complete = false;
      return true;
    }
    seen.add(current.hash);

    const bundle = await readCachedHttpBundleFile(fs, current.path);
    if (!bundle) return false;
    if (isDegradedArtifact(bundle.code)) {
      accumulator.complete = false;
      return true;
    }

    recordBundle({
      hash: current.hash,
      url: extractSourceUrl(bundle.code) ?? current.fallbackUrl,
      sizeBytes: bundle.sizeBytes,
    });
    accumulator.sourceCapture?.record(toFileUrl(current.path).href, bundle.code);

    const deps = extractBundleDeps(bundle.code);
    if (seen.size + deps.length > MAX_HTTP_BUNDLE_GRAPH_ENTRIES) {
      accumulator.complete = false;
      return true;
    }
    for (const dep of deps) {
      if (seen.has(dep.hash)) continue;
      pending.push({
        hash: dep.hash,
        path: join(cacheDir, `http-${dep.hash}.mjs`),
        fallbackUrl: "",
      });
    }
  }

  return true;
}
