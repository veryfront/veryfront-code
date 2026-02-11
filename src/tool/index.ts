/**
 * Define tools with Zod schemas for agents and MCP.
 *
 * @module tool
 *
 * @example Basic tool
 * ```ts
 * import { tool } from "veryfront/tool";
 * import { z } from "zod";
 *
 * const weather = tool({
 *   id: "weather",
 *   description: "Get current weather for a city",
 *   inputSchema: z.object({ city: z.string() }),
 *   execute: async ({ city }) => {
 *     const res = await fetch(`https://api.weather.com/${city}`);
 *     return res.json();
 *   },
 * });
 * ```
 *
 * @example Use with an agent
 * ```ts
 * import { tool } from "veryfront/tool";
 * import { agent } from "veryfront/agent";
 * import { z } from "zod";
 *
 * const weather = tool({
 *   id: "weather",
 *   description: "Get current weather for a city",
 *   inputSchema: z.object({ city: z.string() }),
 *   execute: async ({ city }) => {
 *     const res = await fetch(`https://api.weather.com/${city}`);
 *     return res.json();
 *   },
 * });
 *
 * const assistant = agent({
 *   model: "openai/gpt-4o",
 *   system: "You help with weather questions.",
 *   tools: [weather],
 * });
 * ```
 */

export type { Tool, ToolConfig, ToolDefinition, ToolExecutionContext } from "./types.ts";

export { dynamicTool, tool } from "./factory.ts";
export type { DynamicToolConfig } from "./factory.ts";

export { toolRegistry } from "./registry.ts";

export { executeTool } from "./executor.ts";

export type { JsonSchema } from "./schema/index.ts";
