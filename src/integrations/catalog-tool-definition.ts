import type { ToolDefinition } from "#veryfront/tool/types.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { forEachPrivateArray } from "#veryfront/security/private-array.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { connectors } from "./_data.ts";
import type { IntegrationToolMeta } from "./schema.ts";
import { toolDefinition } from "./local-tool-source.ts";

// Capture data before project modules run. Lookup never consults mutable collection methods.
const catalog = createPrivateMap<string, IntegrationToolMeta & { id: string }>();
forEachPrivateArray(connectors, (connector) => {
  forEachPrivateArray(connector.tools, (tool) => {
    const id = tool.id ?? tool.name;
    const snapshot = snapshotBoundedJsonValue({ ...tool, id });
    if (!snapshot.success) throw new TypeError(`Invalid catalog tool metadata: ${id}`);
    catalog.set(id, snapshot.value as IntegrationToolMeta & { id: string });
  });
});

/**
 * Return credential-free catalog inputs for a declared integration tool.
 * The API owns execution and connection checks, including adapter-backed tools without endpoints.
 */
export function getCatalogToolDefinition(toolName: string): ToolDefinition | undefined {
  const tool = catalog.get(toolName);
  if (!tool) return undefined;
  if (tool.endpoint) return toolDefinition(tool, tool.endpoint, []);
  return {
    name: toolName,
    description: tool.description,
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  };
}
