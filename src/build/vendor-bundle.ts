/**
 * Vendor Bundle Builder
 *
 * Creates per-project vendor bundles containing React and third-party dependencies.
 * Ensures single React instance across SSR and dynamic imports.
 */

export interface VendorBundleResult {
  /** Bundle code */
  code: string;
  /** Content hash for caching */
  hash: string;
  /** Export map: import specifier -> export name */
  exports: Record<string, string>;
}
