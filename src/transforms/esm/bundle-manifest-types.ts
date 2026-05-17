/** A single HTTP bundle entry in a manifest. */
export interface BundleEntry {
  hash: string;
  url: string;
  sizeBytes: number;
}

/** A manifest tracking all HTTP bundles from a single transform. */
export interface BundleManifest {
  manifestId: string;
  bundles: BundleEntry[];
  createdAt: number;
  ttlSeconds: number;
}
