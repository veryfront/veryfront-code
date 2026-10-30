import type { ToolDefinition } from "#veryfront/tool/types.ts";
import { connectors } from "./_data.ts";
import { toolDefinition } from "./local-tool-source.ts";
import { parseIntegrationToolIdentity } from "./source-policy.ts";

/**
 * The definition of a catalog integration tool, whether or not the project connected it.
 *
 * Discovery lists only connected integrations. Studio and hosted runs resolve declared tools on
 * the server, so the model can call one and receive `authentication_required` with a
 * `connectUrl`. A local run exposes the catalog definition for the same reason: the API, not the
 * runtime, decides what a missing connection means.
 */
export function getCatalogToolDefinition(toolName: string): ToolDefinition | undefined {
  const identity = parseIntegrationToolIdentity(toolName);
  if (!identity) return undefined;
  const tool = connectors.find((connector) => connector.name === identity.integration)?.tools
    .find((candidate) => (candidate.id ?? candidate.name) === toolName);
  if (!tool?.endpoint) return undefined;
  try {
    return toolDefinition({ ...tool, id: toolName }, tool.endpoint, []);
  } catch {
    return undefined;
  }
}
