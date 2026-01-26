export interface InvalidationOptions {
    /** Environment scope: only invalidate caches for this environment */
    environment?: "production" | "preview";
    /** Branch ID for preview mode scoping */
    branchId?: string | null;
    /** Project ID for registry-based invalidation */
    projectId?: string;
}
/**
 * Invalidate project caches with optional environment scoping.
 * When environment is specified, only caches for that environment are invalidated.
 */
export declare function invalidateProjectCaches(projectSlug: string, changedPaths?: string[], options?: InvalidationOptions): Promise<void>;
//# sourceMappingURL=cache-invalidation.d.ts.map