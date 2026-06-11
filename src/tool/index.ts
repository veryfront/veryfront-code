/**
 * Define tools with schema-backed inputs for agents and MCP.
 *
 * @module tool
 *
 * @example Basic tool
 * ```ts
 * import { tool } from "veryfront/tool";
 * import { defineSchema } from "veryfront/schemas";
 *
 * const convertLength = tool({
 *   id: "convert_length",
 *   description: "Convert meters to feet",
 *   inputSchema: defineSchema((v) =>
 *     v.object({
 *       meters: v.number().nonnegative().describe("Length in meters"),
 *     })
 *   )(),
 *   execute: ({ meters }) => {
 *     return { feet: meters * 3.28084 };
 *   },
 * });
 * ```
 *
 * @example Use with an agent
 * ```ts
 * import { agent } from "veryfront/agent";
 * import { tool } from "veryfront/tool";
 * import { defineSchema } from "veryfront/schemas";
 *
 * const convertLength = tool({
 *   id: "convert_length",
 *   description: "Convert meters to feet",
 *   inputSchema: defineSchema((v) =>
 *     v.object({
 *       meters: v.number().nonnegative().describe("Length in meters"),
 *     })
 *   )(),
 *   execute: ({ meters }) => {
 *     return { feet: meters * 3.28084 };
 *   },
 * });
 *
 * const assistant = agent({
 *   system: "You answer unit-conversion questions.",
 *   tools: { convert_length: convertLength },
 *   maxSteps: 5,
 * });
 * ```
 *
 * @example Load remote tools for an agent
 * ```ts
 * import { agent } from "veryfront/agent";
 * import { createRemoteMCPToolSource, loadRemoteToolsFromSource } from "veryfront/tool";
 *
 * const docsTools = createRemoteMCPToolSource({
 *   id: "docs-mcp",
 *   endpoint: "https://docs.example.com/mcp",
 *   headers: { Authorization: "Bearer <TOKEN>" },
 * });
 *
 * const runtimeTools = await loadRemoteToolsFromSource(docsTools, {
 *   context: { projectId: "proj_123" },
 *   toolNameAliases: { search_docs: "docs_search" },
 * });
 *
 * const assistant = agent({
 *   system: "Use the docs tools when a question needs project documentation.",
 *   tools: runtimeTools,
 *   maxSteps: 5,
 * });
 *
 * const result = await assistant.generate({
 *   input: "Find the deployment guide for this project.",
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
export { hasToolExecutionErrorMarker, isErroredToolExecutionResult } from "./result.ts";
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
  ProjectScopedRemoteToolDefaultProjectId,
  ProjectScopedRemoteToolDefinitions,
  ProjectScopedRemoteToolExecution,
  ProjectScopedRemoteToolExecutionInput,
  ProjectScopedRemoteToolOptions,
} from "./project-scoped-remote-tools.ts";

export { toolRegistry } from "./registry.ts";

export { executeTool, isToolVisibleTo } from "./executor.ts";

export type { JsonSchema } from "./schema/index.ts";
