import { connectors } from "./_data.ts";
import { isDeclaredIntegration } from "./feature-flags.ts";
import { parseIntegrationToolIdentity } from "./source-policy.ts";

export interface UnconnectedIntegrationTarget {
  readonly projectSlug: string;
  readonly studioOrigin?: string;
}

/**
 * Integrations that the configured tool names declare but the project has not connected.
 *
 * A name qualifies only when it is a canonical `integration__tool` name for a catalog
 * integration and discovery returned no tool for that integration. A name whose integration
 * has discovered tools is a misspelling, not a missing connection.
 */
export function findUnconnectedIntegrations(
  configuredToolNames: readonly string[],
  discoveredToolNames: readonly string[],
): { integrations: string[]; unknownToolNames: string[] } {
  const discovered = new Set<string>();
  for (const name of discoveredToolNames) {
    const identity = parseIntegrationToolIdentity(name);
    if (identity) discovered.add(identity.integration);
  }

  const integrations = new Set<string>();
  const unknownToolNames: string[] = [];
  for (const name of configuredToolNames) {
    const identity = parseIntegrationToolIdentity(name);
    if (
      identity && isDeclaredIntegration(identity.integration) &&
      !discovered.has(identity.integration)
    ) {
      integrations.add(identity.integration);
    } else {
      unknownToolNames.push(name);
    }
  }
  return { integrations: [...integrations].sort(), unknownToolNames };
}

function integrationDisplayName(integration: string): string {
  return connectors.find((connector) => connector.name === integration)?.displayName ??
    integration;
}

/** Name the missing connection and the exact command that fixes it. */
export function formatUnconnectedIntegrationMessage(
  integration: string,
  target: UnconnectedIntegrationTarget,
): string {
  const lines = [
    `${integrationDisplayName(integration)} isn't connected to project ${target.projectSlug}.`,
    `Connect it: npx veryfront integration connect ${integration}`,
  ];
  if (target.studioOrigin) {
    lines.push(
      `Or in Studio: ${target.studioOrigin.replace(/\/$/, "")}/projects/${
        encodeURIComponent(target.projectSlug)
      }/integrations`,
    );
  }
  return lines.join("\n");
}
