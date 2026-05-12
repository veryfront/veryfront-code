/**
 * Declare and register resources exposable over MCP.
 *
 * @module resource
 *
 * @example
 * ```ts
 * import { resource } from "veryfront/resource";
 * import { defineSchema } from "veryfront/schemas";
 *
 * const getParamsSchema = defineSchema((v) =>
 *   v.object({ section: v.string() })
 * );
 *
 * const docs = resource({
 *   pattern: "docs/:section",
 *   description: "API documentation",
 *   paramsSchema: getParamsSchema(),
 *   load: async ({ section }) => {
 *     return { content: await readDocs(section) };
 *   },
 * });
 * ```
 */

export type { Resource, ResourceConfig } from "./types.ts";
export { resource } from "./factory.ts";
export { resourceRegistry } from "./registry.ts";
