/**
 * MCP server exposing tools, prompts, and resources.
 *
 * @module mcp
 *
 * @example
 * ```ts
 * import { createMCPServer } from "veryfront/mcp";
 * import { tool } from "veryfront/tool";
 * import { defineSchema } from "veryfront/schemas";
 *
 * const getSearchInputSchema = defineSchema((v) =>
 *   v.object({ query: v.string() })
 * );
 *
 * // Tools auto-register with MCP when defined
 * tool({
 *   id: "search",
 *   description: "Search docs",
 *   inputSchema: getSearchInputSchema(),
 *   execute: async ({ query }) => ({ results: [] }),
 * });
 *
 * // Start MCP server — registered tools are exposed automatically.
 * // `auth` is required: use bearer for production, or the explicit
 * // `{ type: "none", allowUnauthenticated: true }` opt-in for local dev only.
 * const server = createMCPServer({
 *   enabled: true,
 *   auth: { type: "none", allowUnauthenticated: true },
 * });
 * ```
 */

export type {
  MCPServerConfig,
  MCPStats,
  MCPTool,
  ToolAnnotations,
  ToolListEntry,
} from "./types.ts";

export {
  clearMCPRegistry,
  getMCPRegistry,
  getMCPStats,
  registerPrompt,
  registerResource,
  registerTool,
} from "./registry.ts";

export { createMCPServer, type IntegrationLoaderConfig, MCPServer } from "./server.ts";

export {
  buildFormElicitation,
  buildUrlElicitation,
  type ElicitationRequest,
  type FormElicitationOptions,
  type UrlElicitationOptions,
} from "./elicitation.ts";
export { formatSSEEvent, formatSSEPrimingEvent, formatSSERetry } from "./sse.ts";
export { SessionManager } from "./session.ts";
export { TaskStore } from "./task-store.ts";
export type { Task } from "./task-store.ts";
