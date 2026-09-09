/** Separator between the agent namespace and the capability short name. */
export const AGENT_CAPABILITY_NAMESPACE_SEPARATOR = "--";

/** Sanitizes an agent id into a provider-safe namespace segment. */
export function sanitizeCapabilityNamespace(agentId: string): string {
  return agentId.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** Namespaces a capability short name under its owning agent. */
export function namespaceAgentCapability(agentId: string, shortName: string): string {
  return `${
    sanitizeCapabilityNamespace(agentId)
  }${AGENT_CAPABILITY_NAMESPACE_SEPARATOR}${shortName}`;
}
