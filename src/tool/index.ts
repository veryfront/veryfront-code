/**
 * Tool
 *
 * @module tool
 */

export type { Tool, ToolConfig, ToolDefinition, ToolExecutionContext } from "./types.ts";

export { dynamicTool, tool } from "./factory.ts";
export type { DynamicToolConfig } from "./factory.ts";

export { toolRegistry } from "./registry.ts";

export { executeTool } from "./executor.ts";

export type { JsonSchema } from "./schema/index.ts";
