/**
 * Server-side contract for an extension-owned Studio browser bundle.
 *
 * Core owns the transport and protocol. An explicitly configured extension
 * owns the third-party browser implementation and supplies a complete bundle
 * that was built against the same public Studio bridge composition surface.
 */

import { MAX_BUNDLE_CHUNK_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";
import {
  snapshotImmutableBrowserBundleProvider,
  validateImmutableBrowserBundle,
} from "../browser/immutable-browser-bundle.ts";

export const StudioCaptureBundleProviderName = "StudioCaptureBundleProvider";
export const MAX_STUDIO_CAPTURE_BUNDLE_BYTES = MAX_BUNDLE_CHUNK_SIZE_BYTES;

const STUDIO_BUNDLE_VALIDATION = Object.freeze({
  bundleLabel: "Studio bridge bundle",
  providerLabel: "Studio capture bundle provider",
  maxBytes: MAX_STUDIO_CAPTURE_BUNDLE_BYTES,
});

export interface StudioCaptureBundleProvider {
  /** Self-contained ESM bridge bundle with the capture capability installed. */
  readonly browserBundle: string;
}

/** Validate the shared format and UTF-8 byte budget for every Studio bridge bundle. */
export function validateStudioCaptureBundle(value: unknown): string {
  return validateImmutableBrowserBundle(value, STUDIO_BUNDLE_VALIDATION);
}

/**
 * Snapshot an untrusted extension contract without invoking accessors.
 *
 * The snapshot enforces the shared bundle format and UTF-8 byte budget before
 * a bootstrap generation can be published. The loader reuses the validator.
 */
export function snapshotStudioCaptureBundleProvider(
  value: unknown,
): Readonly<StudioCaptureBundleProvider> {
  return snapshotImmutableBrowserBundleProvider(
    value,
    STUDIO_BUNDLE_VALIDATION,
  );
}

/** Create an immutable provider suitable for extension contract registration. */
export function createStudioCaptureBundleProvider(
  browserBundle: string,
): Readonly<StudioCaptureBundleProvider> {
  return snapshotStudioCaptureBundleProvider({ browserBundle });
}
