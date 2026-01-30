/**
 * Prompt Registry
 *
 * Project-scoped registry for prompt templates. Each project has its own
 * isolated prompt namespace, preventing cross-project prompt access.
 *
 * @module
 */
import { createError, toError } from "../errors/veryfront-error.js";
import { ProjectScopedRegistryManager } from "../ai/registry-manager.js";
const promptManager = new ProjectScopedRegistryManager("prompt");
class PromptRegistryClass {
    register(id, promptInstance) {
        promptManager.register(id, promptInstance);
    }
    /**
     * Register a framework-provided prompt available to all projects.
     */
    registerShared(id, promptInstance) {
        promptManager.registerShared(id, promptInstance);
    }
    get(id) {
        return promptManager.get(id);
    }
    getContent(id, variables) {
        const promptInstance = promptManager.get(id);
        if (!promptInstance) {
            throw toError(createError({
                type: "agent",
                message: `Prompt "${id}" not found`,
            }));
        }
        return promptInstance.getContent(variables);
    }
    getAll() {
        return promptManager.getAll();
    }
    list() {
        return promptManager.getAllIds();
    }
    has(id) {
        return promptManager.has(id);
    }
    clear() {
        promptManager.clear();
    }
    /**
     * Clear everything (for testing).
     */
    clearAll() {
        promptManager.clearAll();
    }
    getStats() {
        return promptManager.getStats();
    }
}
// Singleton instance - maintains same interface but now project-scoped internally
export const promptRegistry = new PromptRegistryClass();
