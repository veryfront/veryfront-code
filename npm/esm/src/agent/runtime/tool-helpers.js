/**
 * Tool Helpers
 *
 * Utilities for tool argument parsing and tool type checking.
 *
 * @module ai/agent/runtime/tool-helpers
 */
import { toolRegistry, toolToProviderDefinition } from "../../tool/index.js";
import { serverLogger as logger } from "../../utils/index.js";
/**
 * Parse tool arguments from raw string or object.
 * Returns parsed args and optional error message.
 */
export function parseToolArgs(rawArgs) {
    try {
        const parsed = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return { args: parsed };
        }
        return { args: {}, error: "Tool call arguments must be a JSON object" };
    }
    catch (error) {
        return {
            args: {},
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
/**
 * Check if a tool is dynamic (for SSE event formatting).
 */
export function isDynamicTool(name) {
    return toolRegistry.get(name)?.type === "dynamic";
}
function logToolDefinition(name, def) {
    logger.debug(`[AGENT] Tool definition for "${name}":`, JSON.stringify(def, null, 2));
}
/**
 * Get available tools based on agent configuration.
 * When tools === true, loads all tools from registry.
 * Otherwise loads specific tools from config.
 */
export function getAvailableTools(toolsConfig) {
    if (!toolsConfig)
        return [];
    if (toolsConfig === true) {
        const allTools = toolRegistry.getAll();
        logger.debug(`[AGENT] Loading all ${allTools.size} tools from registry`);
        return Array.from(allTools, ([name, tool]) => {
            const def = toolToProviderDefinition(tool);
            logToolDefinition(name, def);
            return def;
        });
    }
    const tools = [];
    for (const [name, entry] of Object.entries(toolsConfig)) {
        if (entry === true) {
            const tool = toolRegistry.get(name);
            if (!tool)
                continue;
            const def = toolToProviderDefinition(tool);
            logToolDefinition(name, def);
            tools.push(def);
            continue;
        }
        if (entry && typeof entry === "object") {
            const def = toolToProviderDefinition(entry);
            logToolDefinition(name, def);
            tools.push(def);
        }
    }
    return tools;
}
