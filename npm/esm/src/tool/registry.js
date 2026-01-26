import * as dntShim from "../../_dnt.shims.js";
import { zodToJsonSchema } from "./schema/zod-json-schema.js";
import { agentLogger } from "../utils/logger/logger.js";
class ToolRegistryClass {
    tools = new Map();
    register(id, toolInstance) {
        if (this.tools.has(id)) {
            agentLogger.debug(`Tool "${id}" is already registered. Overwriting.`);
        }
        this.tools.set(id, toolInstance);
    }
    get(id) {
        return this.tools.get(id);
    }
    has(id) {
        return this.tools.has(id);
    }
    getAllIds() {
        return [...this.tools.keys()];
    }
    getAll() {
        return new Map(this.tools);
    }
    clear() {
        this.tools.clear();
    }
    getToolsForProvider() {
        return [...this.tools.values()].map(toolToProviderDefinition);
    }
}
const TOOL_REGISTRY_KEY = "__veryfront_tool_registry__";
const globalRegistry = dntShim.dntGlobalThis;
export const toolRegistry = globalRegistry[TOOL_REGISTRY_KEY] ??=
    new ToolRegistryClass();
export function toolToProviderDefinition(tool) {
    const jsonSchema = tool.inputSchemaJson ?? zodToJsonSchema(tool.inputSchema);
    agentLogger.info(`[TOOL] Using ${tool.inputSchemaJson ? "pre-converted" : "runtime-converted"} schema for "${tool.id}"`);
    return {
        name: tool.id,
        description: tool.description,
        parameters: jsonSchema,
    };
}
