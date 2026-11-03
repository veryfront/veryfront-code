import type { ToolDefinition } from "#veryfront/tool/types.ts";
import { toolDefinition } from "./local-tool-source.ts";
import { findCatalogIntegrationTool } from "./unconnected.ts";

/**
 * The definition of a catalog integration tool, whether or not the project connected it.
 *
 * Discovery lists only connected integrations. Studio and hosted runs resolve declared tools on
 * the server, so the model can call one and receive `authentication_required` with a
 * `connectUrl`. A local run exposes the catalog definition for the same reason: the API, not the
 * runtime, decides what a missing connection means.
 *
 * Undefined for a tool the catalog does not describe with an endpoint (an adapter-backed tool has
 * no input schema here) and for any failure, so the caller falls back to its diagnostic.
 */
export function getCatalogToolDefinition(toolName: string): ToolDefinition | undefined {
  try {
    const tool = findCatalogIntegrationTool(toolName);
    if (!tool?.endpoint) return undefined;
    return toolDefinition({ ...tool, id: toolName }, tool.endpoint, []);
  } catch {
    return undefined;
  }
}
