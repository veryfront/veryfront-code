/** Canonical agent catalog kinds value. */
export const AGENT_CATALOG_KINDS = [
  "template_agent",
  "installable_agent",
] as const;

/** Agent catalog kind contract. */
export type AgentCatalogKind = (typeof AGENT_CATALOG_KINDS)[number];

/** Canonical agent catalog actions value. */
export const AGENT_CATALOG_ACTIONS = [
  "fork",
  "install",
] as const;

/** Agent catalog action contract. */
export type AgentCatalogAction = (typeof AGENT_CATALOG_ACTIONS)[number];

/** Canonical project agent kinds value. */
export const PROJECT_AGENT_KINDS = [
  "source_project_agent",
  "installed_project_agent",
] as const;

/** Project agent kind contract. */
export type ProjectAgentKind = (typeof PROJECT_AGENT_KINDS)[number];

/** Canonical project agent execution kinds value. */
export const PROJECT_AGENT_EXECUTION_KINDS = ["source", "installed"] as const;

/** Project agent execution kind contract. */
export type ProjectAgentExecutionKind = (typeof PROJECT_AGENT_EXECUTION_KINDS)[number];

/** Source project agent execution identity contract. */
export type SourceProjectAgentExecutionIdentity = {
  kind: "source";
  projectId: string;
  agentId: string;
};

/** Installed project agent execution identity contract. */
export type InstalledProjectAgentExecutionIdentity = {
  kind: "installed";
  projectId: string;
  agentId: string;
  catalogEntryId: string;
  agentAccessGrantId: string;
  serviceAccountId: string;
};

/** Project agent execution identity contract. */
export type ProjectAgentExecutionIdentity =
  | SourceProjectAgentExecutionIdentity
  | InstalledProjectAgentExecutionIdentity;

/** Source project agent run snapshot contract. */
export type SourceProjectAgentRunSnapshot = {
  kind: "source";
  project_id: string;
  agent_id: string;
};

/** Installed project agent run snapshot contract. */
export type InstalledProjectAgentRunSnapshot = {
  kind: "installed";
  project_id: string;
  agent_id: string;
  catalog_entry_id: string;
  agent_access_grant_id: string;
  service_account_id: string;
};

/** Project agent run snapshot contract. */
export type ProjectAgentRunSnapshot =
  | SourceProjectAgentRunSnapshot
  | InstalledProjectAgentRunSnapshot;

/** Return true when a value is a supported agent catalog kind. */
export function isAgentCatalogKind(value: string): value is AgentCatalogKind {
  return AGENT_CATALOG_KINDS.includes(value as AgentCatalogKind);
}

/** Return true when a value is a supported agent catalog action. */
export function isAgentCatalogAction(
  value: string,
): value is AgentCatalogAction {
  return AGENT_CATALOG_ACTIONS.includes(value as AgentCatalogAction);
}

/** Return true when a value is a supported project agent kind. */
export function isProjectAgentKind(value: string): value is ProjectAgentKind {
  return PROJECT_AGENT_KINDS.includes(value as ProjectAgentKind);
}

/** Return true when a project agent kind identifies an installed agent. */
export function isInstalledProjectAgentKind(
  value: ProjectAgentKind,
): value is "installed_project_agent" {
  return value === "installed_project_agent";
}

/** Return true when a value is a supported project agent execution kind. */
export function isProjectAgentExecutionKind(
  value: string,
): value is ProjectAgentExecutionKind {
  return PROJECT_AGENT_EXECUTION_KINDS.includes(
    value as ProjectAgentExecutionKind,
  );
}
