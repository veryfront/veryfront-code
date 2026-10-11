/**
 * MCP server exposing tools, prompts, and resources. Resource-template captures
 * are percent-decoded exactly once; malformed escapes are not found, and
 * resources with `mcp.enabled: false` are omitted from both lists and reads.
 * Object output schemas that compile are included in discovery. Calls to those tools
 * validate output and return its snapshot as structured content and serialized
 * text. Validators without JSON Schema compilation omit output contracts;
 * native schemas still validate results, and raw schemas retain text-only results.
 * Contracts without a root object type retain text-only results but are still validated.
 *
 * @module mcp
 *
 * @example
 * ```ts
 * import { createMCPServer } from "veryfront/mcp";
 * import { tool } from "veryfront/tool";
 * import { defineSchema } from "veryfront/schemas";
 *
 * // Tools auto-register with MCP when defined
 * tool({
 *   id: "search",
 *   description: "Search docs",
 *   inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
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

export { createMCPServer, MCPServer } from "./server.ts";

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
