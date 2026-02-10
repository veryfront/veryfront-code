/**
 * Resource definition and registry. Provides a factory function to declare
 * resources that are discoverable and exposable over MCP.
 *
 * @module resource
 */

export type { Resource, ResourceConfig } from "./types.ts";
export { resource } from "./factory.ts";
export { resourceRegistry } from "./registry.ts";
