// Types
export type {
  Tool,
  ToolConfig,
  ToolDefinition,
  ToolExecutionContext,
  ToolRegistryEntry,
  ToolType,
} from "./types.ts";

// Factory functions
export { tool, dynamicTool } from "./factory.ts";
export type { DynamicToolConfig } from "./factory.ts";

// Registry
export { toolRegistry, toolToProviderDefinition } from "./registry.ts";

// Executor
export { executeTool } from "./executor.ts";

// Schema utilities
export { zodToJsonSchema, isOptionalSchema } from "./schema/index.ts";
export type { JsonSchema } from "./schema/index.ts";
