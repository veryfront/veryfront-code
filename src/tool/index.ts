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

export type {
  RemoteToolSource,
  Tool,
  ToolConfig,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionDataEvent,
  ToolSet,
} from "./types.ts";

export { dynamicTool, tool } from "./factory.ts";
export type { DynamicToolConfig } from "./factory.ts";
export { createSleepTool, DEFAULT_SLEEP_TOOL_MAX_SECONDS, sleepTool } from "./sleep.ts";
export type {
  CreateSleepToolOptions,
  SleepToolInput,
  SleepToolOutput,
  SleepToolWait,
} from "./sleep.ts";
export { createRemoteMCPToolSource } from "./remote-mcp.ts";
export type { RemoteMCPToolSourceConfig } from "./remote-mcp.ts";
export { createContext7ToolSource } from "./context7.ts";
export type { Context7ToolSourceConfig } from "./context7.ts";
export { createToolsFromHostDefinitions } from "./host-tools.ts";
export type {
  HostToolDefinition,
  HostToolMaterializationOptions,
  HostToolSet,
} from "./host-tools.ts";
export {
  createToolsFromRemoteDefinitions,
  loadRemoteToolsFromSource,
} from "./remote-source-tools.ts";
export type { RemoteToolMaterializationOptions } from "./remote-source-tools.ts";
export { traceHostTools } from "./tracing.ts";
export type {
  HostToolTraceAttributeInput,
  HostToolTraceAttributes,
  HostToolTraceRunner,
  TraceHostToolsOptions,
} from "./tracing.ts";
export {
  createProjectScopedRemoteToolCatalog,
  filterProjectScopedRemoteToolDefinitions,
  hydrateProjectScopedRemoteToolInput,
  isProjectNavigationRemoteTool,
  isRemoteToolNameAllowed,
  listProjectScopedRemoteToolNames,
  resolveProjectScopedRemoteToolProjectId,
} from "./project-scoped-remote-tools.ts";
export type {
  ListProjectScopedRemoteToolNameOptions,
  ProjectScopedRemoteToolCatalog,
  ProjectScopedRemoteToolCatalogOptions,
  ProjectScopedRemoteToolDefinitions,
  ProjectScopedRemoteToolExecution,
  ProjectScopedRemoteToolExecutionInput,
  ProjectScopedRemoteToolOptions,
} from "./project-scoped-remote-tools.ts";

export { toolRegistry } from "./registry.ts";

export { executeTool } from "./executor.ts";

export type { JsonSchema } from "./schema/index.ts";
