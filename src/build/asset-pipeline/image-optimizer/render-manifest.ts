import { computeHash } from "#veryfront/utils";
import {
  canonicalOptimizedImageManifestPath,
  captureOptimizedImageManifestRenderSession,
  MAX_OPTIMIZED_IMAGE_HYDRATION_BYTES,
  MAX_OPTIMIZED_IMAGE_REFERENCES_PER_RENDER,
  normalizeOptimizedImageSourcePath,
  snapshotOptimizedImageManifest,
  snapshotOptimizedImageMetadata,
} from "#veryfront/utils/optimized-image-manifest.ts";
import type {
  OptimizedImageManifestRenderSession,
  OptimizedImageManifestSnapshot,
  OptimizedImageMetadata,
} from "#veryfront/types";
import { MAX_IMAGE_FILES, MAX_IMAGE_MANIFEST_BYTES } from "./constants.ts";

export interface OptimizedImageManifestResolver {
  readonly identity: string;
  createRenderSession(): OptimizedImageManifestRenderSession;
  /** Full bounded manifest used only to initialize an isolated build worker. */
  snapshotAll(): OptimizedImageManifestSnapshot;
}

const encoder = new TextEncoder();

export { captureOptimizedImageManifestRenderSession };

/** Build one immutable resolver shared by all route-scoped render sessions. */
async function createResolver(
  manifest: ReadonlyMap<string, OptimizedImageMetadata>,
  expectedIdentity?: string,
): Promise<OptimizedImageManifestResolver> {
  if (!(manifest instanceof Map) || manifest.size > MAX_IMAGE_FILES) {
    throw new TypeError(`Optimized image manifest exceeds ${MAX_IMAGE_FILES} entries`);
  }
  const entries = [...manifest].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  const canonical = new Map<string, OptimizedImageMetadata>();
  const identityRecord = Object.create(null) as Record<string, OptimizedImageMetadata>;
  for (const [rawKey, rawMetadata] of entries) {
    const key = canonicalOptimizedImageManifestPath(rawKey);
    if (key !== rawKey || canonical.has(key)) {
      throw new TypeError("Optimized image manifest contains a non-canonical key");
    }
    const metadata = snapshotOptimizedImageMetadata(rawMetadata, key);
    canonical.set(key, metadata);
    Object.defineProperty(identityRecord, key, {
      configurable: false,
      enumerable: true,
      value: metadata,
      writable: false,
    });
  }
  const serialized = JSON.stringify(identityRecord);
  if (encoder.encode(serialized).byteLength > MAX_IMAGE_MANIFEST_BYTES) {
    throw new TypeError(`Optimized image manifest exceeds ${MAX_IMAGE_MANIFEST_BYTES} bytes`);
  }
  const identity = await computeHash(serialized);
  if (expectedIdentity !== undefined && identity !== expectedIdentity) {
    throw new TypeError("Optimized image manifest identity does not match its entries");
  }
  const fullSnapshot = snapshotOptimizedImageManifest(
    { identity, entries: identityRecord },
    { maxEntries: MAX_IMAGE_FILES, maxBytes: MAX_IMAGE_MANIFEST_BYTES },
  );

  return Object.freeze({
    identity,
    snapshotAll(): OptimizedImageManifestSnapshot {
      return fullSnapshot;
    },
    createRenderSession(): OptimizedImageManifestRenderSession {
      const referenced = new Map<string, OptimizedImageMetadata>();
      return Object.freeze({
        identity,
        resolve(source: string): OptimizedImageMetadata {
          const key = normalizeOptimizedImageSourcePath(source);
          const metadata = canonical.get(key);
          if (!metadata) {
            throw new TypeError(
              `Optimized image manifest has no entry for ${JSON.stringify(key)}`,
            );
          }
          if (!referenced.has(key)) {
            if (referenced.size >= MAX_OPTIMIZED_IMAGE_REFERENCES_PER_RENDER) {
              throw new RangeError(
                `Rendered route references more than ${MAX_OPTIMIZED_IMAGE_REFERENCES_PER_RENDER} optimized images`,
              );
            }
            referenced.set(key, metadata);
          }
          return metadata;
        },
        snapshotReferenced(): OptimizedImageManifestSnapshot {
          const subset = Object.create(null) as Record<string, OptimizedImageMetadata>;
          for (
            const [key, metadata] of [...referenced].sort(([left], [right]) =>
              left < right ? -1 : left > right ? 1 : 0
            )
          ) {
            Object.defineProperty(subset, key, {
              configurable: false,
              enumerable: true,
              value: metadata,
              writable: false,
            });
          }
          return snapshotOptimizedImageManifest(
            { identity, entries: subset },
            {
              maxEntries: MAX_OPTIMIZED_IMAGE_REFERENCES_PER_RENDER,
              maxBytes: MAX_OPTIMIZED_IMAGE_HYDRATION_BYTES,
            },
          );
        },
      });
    },
  });
}

/** Build one immutable resolver shared by all route-scoped render sessions. */
export function createOptimizedImageManifestResolver(
  manifest: ReadonlyMap<string, OptimizedImageMetadata>,
): Promise<OptimizedImageManifestResolver> {
  return createResolver(manifest);
}

/** Validate a serialized full manifest and reconstruct its request-scoped resolver. */
export function restoreOptimizedImageManifestResolver(
  value: unknown,
): Promise<OptimizedImageManifestResolver> {
  const snapshot = snapshotOptimizedImageManifest(value, {
    maxEntries: MAX_IMAGE_FILES,
    maxBytes: MAX_IMAGE_MANIFEST_BYTES,
  });
  return createResolver(
    new Map(Object.entries(snapshot.entries)),
    snapshot.identity,
  );
}
