/**
 * Cached JSX module normalization utilities.
 *
 * Ensures cached JSX modules don't contain relative _dnt.* imports that break
 * when the file is moved into the MDX cache directory.
 */
/**
 * Validate and patch a cached JSX module in-place.
 *
 * Returns true if the cached module is usable, false if it should be re-generated.
 */
export declare function ensureCachedJsxModulePatched(transformedPath: string, sourceFilePath: string): Promise<boolean>;
//# sourceMappingURL=jsx-cache.d.ts.map