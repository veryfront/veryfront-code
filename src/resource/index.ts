/**
 * Declare and register resources exposable over MCP.
 *
 * @module resource
 *
 * @example
 * ```ts
 * import { resource } from "veryfront/resource";
 * import { z } from "zod";
 *
 * const docsBySection: Record<string, string> = {
 *   agents: "Agents accept messages, tools, context, and runtime options.",
 *   tools: "Tools expose schema-backed callable capabilities.",
 * };
 *
 * const docs = resource({
 *   pattern: "docs/:section",
 *   description: "API documentation",
 *   paramsSchema: z.object({ section: z.string() }),
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
