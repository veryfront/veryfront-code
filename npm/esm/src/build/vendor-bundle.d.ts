export interface VendorBundleConfig {
    /** Project identifier for cache isolation */
    projectId: string;
    /** React version to bundle */
    reactVersion: string;
    /** Third-party dependencies to include */
    dependencies: Record<string, string>;
    /** Development mode */
    dev?: boolean;
}
export interface VendorBundleResult {
    /** Bundle code */
    code: string;
    /** Content hash for caching */
    hash: string;
    /** Export map: import specifier -> export name */
    exports: Record<string, string>;
}
/**
 * Build vendor bundle containing React and third-party packages
 *
 * Strategy:
 * 1. Create virtual entry point that imports all dependencies
 * 2. Bundle with esbuild (format: esm, platform: browser)
 * 3. Mark nothing as external (bundle everything)
 * 4. Return bundle code with export map
 *
 * @param config Vendor bundle configuration
 * @returns Vendor bundle result
 */
export declare function buildVendorBundle(config: VendorBundleConfig): Promise<VendorBundleResult>;
//# sourceMappingURL=vendor-bundle.d.ts.map