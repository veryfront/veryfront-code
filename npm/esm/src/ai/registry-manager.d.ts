/**
 * Project-Scoped Registry Manager
 *
 * Provides multi-tenant isolation for AI registries (tools, prompts, workflows,
 * agents, resources, providers). Each project gets its own isolated registry
 * namespace, preventing cross-project leakage of AI resources.
 *
 * Usage:
 * ```ts
 * const toolManager = new ProjectScopedRegistryManager<Tool>("tool");
 *
 * // Register for current project (uses AsyncLocalStorage context)
 * toolManager.register("my-tool", myTool);
 *
 * // Get for current project
 * const tool = toolManager.get("my-tool");
 *
 * // Register framework-provided tools (available to all projects)
 * toolManager.registerShared("veryfront-search", searchTool);
 * ```
 *
 * @module
 */
/**
 * Base class for project-scoped registries.
 * Provides isolation between projects while allowing
 * cross-project sharing of explicitly shared items.
 */
export declare class ProjectScopedRegistryManager<T> {
    private registriesByProject;
    private sharedRegistry;
    private registryName;
    constructor(registryName: string);
    /**
     * Get the current project ID from AsyncLocalStorage context.
     * Falls back to default for CLI/test scenarios.
     */
    private getCurrentProjectId;
    /**
     * Get or create registry for a specific project.
     */
    private getProjectRegistry;
    /**
     * Register an item for the current project.
     */
    register(id: string, item: T): void;
    /**
     * Register a shared item available to all projects.
     * Use for framework-provided tools, not user-defined ones.
     */
    registerShared(id: string, item: T): void;
    /**
     * Get item for the current project.
     * Falls back to shared registry for items not found in project registry.
     */
    get(id: string): T | undefined;
    /**
     * Check if item exists for the current project.
     */
    has(id: string): boolean;
    /**
     * Get all IDs for the current project (includes shared items).
     */
    getAllIds(): string[];
    /**
     * Get all items for the current project (includes shared items).
     */
    getAll(): Map<string, T>;
    /**
     * Delete an item from the current project's registry.
     */
    delete(id: string): boolean;
    /**
     * Clear all items for the current project.
     */
    clear(): void;
    /**
     * Clear a specific project's registry.
     */
    clearProject(projectId: string): void;
    /**
     * Clear everything (for testing).
     */
    clearAll(): void;
    /**
     * Get stats for monitoring.
     */
    getStats(): {
        projectCount: number;
        sharedCount: number;
        totalItems: number;
        currentProjectItems: number;
    };
}
//# sourceMappingURL=registry-manager.d.ts.map