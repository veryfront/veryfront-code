/**
 * Tool Registry
 *
 * Project-scoped registry for AI tools. Each project has its own isolated
 * tool namespace, preventing cross-project tool access.
 *
 * @module
 */
import { zodToJsonSchema } from "./schema/zod-json-schema.js";
import { agentLogger } from "../utils/logger/logger.js";
import { ProjectScopedRegistryManager } from "../ai/registry-manager.js";
const toolManager = new ProjectScopedRegistryManager("tool");
class ToolRegistryClass {
    register(id, toolInstance) {
        toolManager.register(id, toolInstance);
    }
    /**
     * Register a framework-provided tool available to all projects.
     */
    registerShared(id, toolInstance) {
        toolManager.registerShared(id, toolInstance);
    }
    get(id) {
        return toolManager.get(id);
    }
    has(id) {
        return toolManager.has(id);
    }
    getAllIds() {
        return toolManager.getAllIds();
    }
    getAll() {
        return toolManager.getAll();
    }
    clear() {
        toolManager.clear();
    }
    /**
     * Clear everything (for testing).
     */
    clearAll() {
        toolManager.clearAll();
    }
    getToolsForProvider() {
        return [...this.getAll().values()].map(toolToProviderDefinition);
    }
    getStats() {
        return toolManager.getStats();
    }
}
// Singleton instance - maintains same interface but now project-scoped internally
export const toolRegistry = new ToolRegistryClass();
export function toolToProviderDefinition(tool) {
    const jsonSchema = tool.inputSchemaJson ?? zodToJsonSchema(tool.inputSchema);
    agentLogger.info(`[TOOL] Using ${tool.inputSchemaJson ? "pre-converted" : "runtime-converted"} schema for "${tool.id}"`);
    return {
        name: tool.id,
        description: tool.description,
        parameters: jsonSchema,
    };
}
