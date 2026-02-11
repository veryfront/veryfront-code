/**
 * @module integrations
 * Integration metadata and SVG icons for all connectors.
 *
 * @example
 * ```ts
 * import { listConnectors, getIcon } from "veryfront/integrations";
 *
 * const connectors = listConnectors();
 * const slackIcon = getIcon("slack"); // raw SVG string
 * ```
 */
export type {
  EnvVarConfig,
  IntegrationConfig,
  IntegrationName,
  IntegrationPrompt,
  IntegrationToolMeta,
  OAuthConfig,
} from "./types.ts";

import { connectors, icons } from "./_data.ts";
import type { IntegrationConfig } from "./types.ts";

const byName = new Map(
  connectors.map((c): [string, IntegrationConfig] => [c.name, c]),
);
const iconMap = new Map(Object.entries(icons));

export function getConnector(name: string) {
  return byName.get(name);
}

export function listConnectors() {
  return connectors;
}

export function getConnectorNames() {
  return connectors.map((c) => c.name);
}

export function getIcon(name: string) {
  return iconMap.get(name);
}
