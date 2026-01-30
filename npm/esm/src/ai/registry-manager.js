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
import { tryGetCacheKeyContext } from "../cache/cache-key-builder.js";
import { agentLogger } from "../utils/logger/logger.js";
const DEFAULT_PROJECT_ID = "__default__";
/**
 * Base class for project-scoped registries.
 * Provides isolation between projects while allowing
 * cross-project sharing of explicitly shared items.
 */
export class ProjectScopedRegistryManager {
    registriesByProject = new Map();
    sharedRegistry = new Map();
    registryName;
    constructor(registryName) {
        this.registryName = registryName;
    }
    /**
     * Get the current project ID from AsyncLocalStorage context.
     * Falls back to default for CLI/test scenarios.
     */
    getCurrentProjectId() {
        const ctx = tryGetCacheKeyContext();
        return ctx?.projectId ?? DEFAULT_PROJECT_ID;
    }
    /**
     * Get or create registry for a specific project.
     */
    getProjectRegistry(projectId) {
        let registry = this.registriesByProject.get(projectId);
        if (!registry) {
            registry = new Map();
            this.registriesByProject.set(projectId, registry);
        }
        return registry;
    }
    /**
     * Register an item for the current project.
     */
    register(id, item) {
        const projectId = this.getCurrentProjectId();
        const registry = this.getProjectRegistry(projectId);
        if (registry.has(id)) {
            agentLogger.debug(`[${this.registryName}] "${id}" already registered for project ${projectId}. Overwriting.`);
        }
        registry.set(id, item);
        agentLogger.debug(`[${this.registryName}] Registered "${id}" for project ${projectId}`);
    }
    /**
     * Register a shared item available to all projects.
     * Use for framework-provided tools, not user-defined ones.
     */
    registerShared(id, item) {
        if (this.sharedRegistry.has(id)) {
            agentLogger.debug(`[${this.registryName}] Shared "${id}" already registered. Overwriting.`);
        }
        this.sharedRegistry.set(id, item);
        agentLogger.debug(`[${this.registryName}] Registered shared "${id}"`);
    }
    /**
     * Get item for the current project.
     * Falls back to shared registry for items not found in project registry.
     */
    get(id) {
        const projectId = this.getCurrentProjectId();
        const projectRegistry = this.registriesByProject.get(projectId);
        // First check project-specific registry
        const projectItem = projectRegistry?.get(id);
        if (projectItem !== undefined)
            return projectItem;
        // Fall back to shared (framework-provided) items
        return this.sharedRegistry.get(id);
    }
    /**
     * Check if item exists for the current project.
     */
    has(id) {
        const projectId = this.getCurrentProjectId();
        const projectRegistry = this.registriesByProject.get(projectId);
        return (projectRegistry?.has(id) ?? false) || this.sharedRegistry.has(id);
    }
    /**
     * Get all IDs for the current project (includes shared items).
     */
    getAllIds() {
        const projectId = this.getCurrentProjectId();
        const projectIds = Array.from(this.registriesByProject.get(projectId)?.keys() ?? []);
        const sharedIds = Array.from(this.sharedRegistry.keys());
        return [...new Set([...projectIds, ...sharedIds])];
    }
    /**
     * Get all items for the current project (includes shared items).
     */
    getAll() {
        const projectId = this.getCurrentProjectId();
        const result = new Map(this.sharedRegistry);
        const projectRegistry = this.registriesByProject.get(projectId);
        if (projectRegistry) {
            for (const [id, item] of projectRegistry) {
                result.set(id, item); // Project items override shared
            }
        }
        return result;
    }
    /**
     * Delete an item from the current project's registry.
     */
    delete(id) {
        const projectId = this.getCurrentProjectId();
        const registry = this.registriesByProject.get(projectId);
        if (!registry?.has(id))
            return false;
        registry.delete(id);
        agentLogger.debug(`[${this.registryName}] Deleted "${id}" from project ${projectId}`);
        return true;
    }
    /**
     * Clear all items for the current project.
     */
    clear() {
        const projectId = this.getCurrentProjectId();
        this.registriesByProject.delete(projectId);
        agentLogger.debug(`[${this.registryName}] Cleared registry for project ${projectId}`);
    }
    /**
     * Clear a specific project's registry.
     */
    clearProject(projectId) {
        this.registriesByProject.delete(projectId);
        agentLogger.debug(`[${this.registryName}] Cleared registry for project ${projectId}`);
    }
    /**
     * Clear everything (for testing).
     */
    clearAll() {
        this.registriesByProject.clear();
        this.sharedRegistry.clear();
        agentLogger.debug(`[${this.registryName}] Cleared all registries`);
    }
    /**
     * Get stats for monitoring.
     */
    getStats() {
        const projectId = this.getCurrentProjectId();
        let totalItems = this.sharedRegistry.size;
        for (const registry of this.registriesByProject.values()) {
            totalItems += registry.size;
        }
        return {
            projectCount: this.registriesByProject.size,
            sharedCount: this.sharedRegistry.size,
            totalItems,
            currentProjectItems: this.registriesByProject.get(projectId)?.size ?? 0,
        };
    }
}
