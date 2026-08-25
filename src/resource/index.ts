/**
 * Declare and register schema-backed URI resources exposable over MCP. URI
 * templates support hierarchical, rootless, embedded, and query parameters;
 * opaque identifiers remain literal. Captures are percent-decoded exactly once,
 * malformed escapes do not match, and `mcp.enabled: false` hides list and read.
 *
 * @module resource
 *
 * @example
 * ```ts
 * import { resource } from "veryfront/resource";
 * import { defineSchema } from "veryfront/schemas";
 *
 * const docsBySection: Record<string, string> = {
 *   agents: "Agents accept messages, tools, context, and runtime options.",
 *   tools: "Tools expose schema-backed callable capabilities.",
 * };
 *
 * const docs = resource({
 *   pattern: "docs/:section",
 *   description: "API documentation",
 *   paramsSchema: defineSchema((v) => v.object({ section: v.string() }))(),
 *   load: ({ section }) => {
 *     return { content: docsBySection[section] ?? "Section not found." };
 *   },
 * });
 *
 * const result = await docs.load({ section: "agents" });
 * ```
 */

export type { Resource, ResourceConfig } from "./types.ts";
export { resource } from "./factory.ts";
export { resourceRegistry } from "./registry.ts";
