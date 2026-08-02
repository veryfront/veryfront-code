/** Extension contract for the framework-owned local development UIs. */

import { MAX_BUNDLE_CHUNK_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";
import {
  snapshotImmutableBrowserBundleProvider,
  validateImmutableBrowserBundle,
} from "../browser/immutable-browser-bundle.ts";

export const DevUiAssetProviderName = "DevUiAssetProvider";
export const MAX_DEV_UI_BUNDLE_BYTES = MAX_BUNDLE_CHUNK_SIZE_BYTES;

const DEV_UI_BUNDLE_VALIDATION = Object.freeze({
  bundleLabel: "Development UI bundle",
  providerLabel: "Development UI asset provider",
  maxBytes: MAX_DEV_UI_BUNDLE_BYTES,
});

/** One self-contained browser bundle mounts dashboard or projects by shell identity. */
export interface DevUiAssetProvider {
  readonly browserBundle: string;
}

export function validateDevUiBundle(value: unknown): string {
  return validateImmutableBrowserBundle(value, DEV_UI_BUNDLE_VALIDATION);
}

export function snapshotDevUiAssetProvider(
  value: unknown,
): Readonly<DevUiAssetProvider> {
  return snapshotImmutableBrowserBundleProvider(value, DEV_UI_BUNDLE_VALIDATION);
}

export function createDevUiAssetProvider(
  browserBundle: string,
): Readonly<DevUiAssetProvider> {
  return snapshotDevUiAssetProvider({ browserBundle });
}
