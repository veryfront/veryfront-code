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
import type { IntegrationConfig, IntegrationName } from "./schema.ts";

const iconMap = new Map(Object.entries(icons));

function deepFreezeCatalog(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  const pending: object[] = [value];
  const visited = new WeakSet<object>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const nested of Object.values(current)) {
      if (typeof nested === "object" && nested !== null) pending.push(nested);
    }
    Object.freeze(current);
  }
}

deepFreezeCatalog(connectors);
deepFreezeCatalog(icons);

/** Return a visible connector by name. */
export function getConnector(name: IntegrationName | string): IntegrationConfig | undefined {
  const normalizedName = typeof name === "string" ? normalizeIntegrationName(name) : "";
  if (!normalizedName || !isVisibleIntegration(normalizedName)) return undefined;
  return connectors.find((connector) => connector.name === normalizedName);
}

/** List visible connectors. */
export function listConnectors(): readonly IntegrationConfig[] {
  return Object.freeze(filterVisibleIntegrations(connectors));
}

/** Return visible connector names. */
export function getConnectorNames(): readonly string[] {
  return Object.freeze(listConnectors().map((connector) => connector.name));
}

/** Return a visible connector's SVG icon. */
export function getIcon(name: IntegrationName | string): string | undefined {
  const normalizedName = typeof name === "string" ? normalizeIntegrationName(name) : "";
  if (!normalizedName || !isVisibleIntegration(normalizedName)) return undefined;
  return iconMap.get(normalizedName);
}

// Remote integration tool helpers (per-request, no global registration)
export {
  executeRemoteIntegrationTool,
  getRemoteIntegrationToolDefinitions,
  isRemoteIntegrationTool,
} from "./remote-tools.ts";
export type {
  RemoteIntegrationToolDefinition,
  RemoteIntegrationToolExecutionContext,
} from "./remote-tools.ts";
export type {
  IntegrationConnector,
  IntegrationEndpoint,
  IntegrationEndpointBodyField,
  IntegrationEndpointParam,
  IntegrationEndpointResponse,
  IntegrationEndpointResponseEnrichment,
  IntegrationHistoricalSummary,
  IntegrationHistoricalSummaryField,
  IntegrationHistoricalSummaryFieldKind,
  IntegrationTool,
} from "./types.ts";
