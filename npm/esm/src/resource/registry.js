/**
 * Resource Registry
 *
 * Project-scoped registry for MCP resources. Each project has its own
 * isolated resource namespace, preventing cross-project resource access.
 *
 * @module
 */
import { ProjectScopedRegistryManager } from "../ai/registry-manager.js";
const resourceManager = new ProjectScopedRegistryManager("resource");
class ResourceRegistryClass {
    register(id, resourceInstance) {
        resourceManager.register(id, resourceInstance);
    }
    /**
     * Register a framework-provided resource available to all projects.
     */
    registerShared(id, resourceInstance) {
        resourceManager.registerShared(id, resourceInstance);
    }
    get(id) {
        return resourceManager.get(id);
    }
    findByPattern(uri) {
        for (const resource of this.getAll().values()) {
            if (this.matchesPattern(uri, resource.pattern))
                return resource;
        }
        return undefined;
    }
    patternToRegex(pattern) {
        return new RegExp(`^${pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`);
    }
    matchesPattern(uri, pattern) {
        return this.patternToRegex(pattern).test(uri);
    }
    extractParams(uri, pattern) {
        return uri.match(this.patternToRegex(pattern))?.groups ?? {};
    }
    getAll() {
        return resourceManager.getAll();
    }
    list() {
        return resourceManager.getAllIds();
    }
    has(id) {
        return resourceManager.has(id);
    }
    clear() {
        resourceManager.clear();
    }
    /**
     * Clear everything (for testing).
     */
    clearAll() {
        resourceManager.clearAll();
    }
    getStats() {
        return resourceManager.getStats();
    }
}
// Singleton instance - maintains same interface but now project-scoped internally
export const resourceRegistry = new ResourceRegistryClass();
