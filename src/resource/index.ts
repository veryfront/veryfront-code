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
 * const docs = resource({
 *   pattern: "docs/:section",
 *   description: "API documentation",
 *   paramsSchema: z.object({ section: z.string() }),
 *   load: async ({ section }) => {
 *     return { content: await readDocs(section) };
 *   },
 * });
 * ```
 */

export type { Resource, ResourceConfig } from "./types.ts";
export { resource } from "./factory.ts";
export { resourceRegistry } from "./registry.ts";
