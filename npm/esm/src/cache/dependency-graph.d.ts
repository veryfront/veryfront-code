/**
 * Dependency graph for import tracking and cache invalidation.
 *
 * Used to compute depsHash for transform cache keys, ensuring that
 * cache entries are invalidated when any transitive dependency changes.
 */
/**
 * Dependency graph for a set of modules.
 */
export declare class DependencyGraph {
    /** Map from file path to its direct dependencies */
    private dependencies;
    /** Map from file path to files that depend on it */
    private dependents;
    /**
     * Add a module and its dependencies to the graph.
     */
    addModule(filePath: string, dependencies: string[]): void;
    /**
     * Get direct dependencies of a module.
     */
    getDirectDependencies(filePath: string): string[];
    /**
     * Get all transitive dependencies of a module (with cycle detection).
     */
    getTransitiveDependencies(filePath: string): string[];
    /**
     * Get all modules that directly or transitively depend on a file.
     */
    getDependents(filePath: string): string[];
    /**
     * Check if adding a dependency would create a cycle.
     */
    wouldCreateCycle(from: string, to: string): boolean;
    /**
     * Clear the graph.
     */
    clear(): void;
    /**
     * Get all modules in the graph.
     */
    getAllModules(): string[];
    private collectDeps;
    private collectDependents;
}
/**
 * Extract import specifiers from code.
 */
export declare function extractImports(code: string): Promise<string[]>;
/**
 * Filter imports to only local/relative paths (not npm packages or URLs).
 */
export declare function filterLocalImports(specifiers: string[]): string[];
/**
 * Normalize import specifier to a file path.
 */
export declare function normalizeSpecifierToPath(specifier: string, fromFile: string, projectDir: string): string;
/**
 * Compute a hash of dependencies for a module.
 *
 * @param filePath - The module's file path
 * @param getContent - Function to get file content by path
 * @param projectDir - Project root directory
 * @returns Hash string representing all transitive dependencies
 */
export declare function computeDepsHash(filePath: string, getContent: (path: string) => Promise<string>, projectDir: string): Promise<string>;
//# sourceMappingURL=dependency-graph.d.ts.map