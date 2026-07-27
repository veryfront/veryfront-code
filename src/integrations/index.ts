/**
 * @module integrations
 * Integration metadata and SVG icons for all connectors.
 *
 * @example
 * ```ts
 * import {
 *   getConnector,
 *   getIcon,
 *   getRemoteIntegrationToolDefinitions,
 *   listConnectors,
 * } from "veryfront/integrations";
 *
 * const connectors = listConnectors();
 * const slack = getConnector("slack");
 * const slackIcon = getIcon("slack"); // raw SVG string
 * const runtimeTools = await getRemoteIntegrationToolDefinitions();
 * ```
 */
export type {
  EnvVarConfig,
  IntegrationConfig,
  IntegrationEndpointHistoricalSummary,
  IntegrationName,
  IntegrationPrompt,
  IntegrationToolMeta,
  OAuthConfig,
  OAuthField,
} from "./schema.ts";

export {
  EnvVarSchema,
  IntegrationConfigSchema,
  IntegrationEndpointHistoricalSummarySchema,
  IntegrationNameSchema,
  IntegrationPromptSchema,
  IntegrationToolSchema,
  OAuthConfigSchema,
  OAuthFieldSchema,
} from "./schema.ts";

import { connectors, icons } from "./_data.ts";
import {
  filterVisibleIntegrations,
  isVisibleIntegration,
  normalizeIntegrationName,
} from "./feature-flags.ts";
import { MAX_INTEGRATION_NAME_LENGTH } from "./limits.ts";
import type { IntegrationConfig, IntegrationName } from "./schema.ts";

function deepFreezeCatalog<T extends object>(root: T): T {
  const pending: object[] = [root];
  const visited = new WeakSet<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (!value || visited.has(value)) continue;
    visited.add(value);

    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if (
        "value" in descriptor &&
        typeof descriptor.value === "object" &&
        descriptor.value !== null
      ) {
        pending.push(descriptor.value);
      }
    }
    Object.freeze(value);
  }
  return root;
}

const connectorCatalog = deepFreezeCatalog(connectors);
const connectorMap: ReadonlyMap<string, IntegrationConfig> = new Map(
  connectorCatalog.map((connector) => [connector.name, connector] as const),
);
const iconMap = new Map(Object.entries(icons));

/** Return a visible connector after trimming and case-normalizing its name. */
export function getConnector(name: IntegrationName | string): IntegrationConfig | undefined {
  if (typeof name !== "string" || name.length > MAX_INTEGRATION_NAME_LENGTH) return undefined;
  const normalizedName = normalizeIntegrationName(name);
  if (!isVisibleIntegration(normalizedName)) return undefined;
  return connectorMap.get(normalizedName);
}

/** List visible connectors backed by deeply frozen catalog metadata. */
export function listConnectors(): readonly IntegrationConfig[] {
  return filterVisibleIntegrations(connectorCatalog);
}

/** Return connector names. */
export function getConnectorNames(): readonly string[] {
  return listConnectors().map((connector) => connector.name);
}

/** Return a visible connector's icon after trimming and case-normalizing its name. */
export function getIcon(name: IntegrationName | string): string | undefined {
  if (typeof name !== "string" || name.length > MAX_INTEGRATION_NAME_LENGTH) return undefined;
  const normalizedName = normalizeIntegrationName(name);
  if (!isVisibleIntegration(normalizedName)) return undefined;
  return iconMap.get(normalizedName);
}

// Remote integration tool helpers (per-request, no global registration)
export {
  executeRemoteIntegrationTool,
  getRemoteIntegrationToolDefinitions,
  isRemoteIntegrationTool,
} from "./remote-tools.ts";
export type { IntegrationConnector, IntegrationTool } from "./types.ts";
