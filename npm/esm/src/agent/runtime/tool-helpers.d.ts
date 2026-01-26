/**
 * Tool Helpers
 *
 * Utilities for tool argument parsing and tool type checking.
 *
 * @module ai/agent/runtime/tool-helpers
 */
import type { Tool, ToolDefinition } from "../../tool/index.js";
/**
 * Result of parsing tool arguments.
 */
export interface ParsedToolArgs {
    args: Record<string, unknown>;
    error?: string;
}
/**
 * Parse tool arguments from raw string or object.
 * Returns parsed args and optional error message.
 */
export declare function parseToolArgs(rawArgs: string | Record<string, unknown>): ParsedToolArgs;
/**
 * Check if a tool is dynamic (for SSE event formatting).
 */
export declare function isDynamicTool(name: string): boolean;
/**
 * Tool configuration entry from agent config.
 * Can be a boolean (true to enable from registry) or a Tool instance.
 */
export type ToolConfigEntry = Tool<any, any> | boolean;
/**
 * Get available tools based on agent configuration.
 * When tools === true, loads all tools from registry.
 * Otherwise loads specific tools from config.
 */
export declare function getAvailableTools(toolsConfig: true | Record<string, ToolConfigEntry> | undefined): ToolDefinition[];
//# sourceMappingURL=tool-helpers.d.ts.map