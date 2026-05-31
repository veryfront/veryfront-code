export const AGENT_CATALOG_KINDS = [
  "template_agent",
  "installable_agent",
] as const;

export type AgentCatalogKind = (typeof AGENT_CATALOG_KINDS)[number];

export const AGENT_CATALOG_ACTIONS = [
  "fork",
  "install",
] as const;

export type AgentCatalogAction = (typeof AGENT_CATALOG_ACTIONS)[number];

export const PROJECT_AGENT_KINDS = [
  "source_project_agent",
  "installed_project_agent",
] as const;

export type ProjectAgentKind = (typeof PROJECT_AGENT_KINDS)[number];

export const PROJECT_AGENT_EXECUTION_KINDS = ["source", "installed"] as const;

export type ProjectAgentExecutionKind = (typeof PROJECT_AGENT_EXECUTION_KINDS)[number];

export type SourceProjectAgentExecutionIdentity = {
  kind: "source";
  projectId: string;
  agentId: string;
};

export type InstalledProjectAgentExecutionIdentity = {
  kind: "installed";
  projectId: string;
  agentId: string;
  catalogEntryId: string;
  agentAccessGrantId: string;
  serviceAccountId: string;
};

export type ProjectAgentExecutionIdentity =
  | SourceProjectAgentExecutionIdentity
  | InstalledProjectAgentExecutionIdentity;

export type SourceProjectAgentRunSnapshot = {
  kind: "source";
  project_id: string;
  agent_id: string;
};

export type InstalledProjectAgentRunSnapshot = {
  kind: "installed";
  project_id: string;
  agent_id: string;
  catalog_entry_id: string;
  agent_access_grant_id: string;
  service_account_id: string;
};

export type ProjectAgentRunSnapshot =
  | SourceProjectAgentRunSnapshot
  | InstalledProjectAgentRunSnapshot;

export function isAgentCatalogKind(value: string): value is AgentCatalogKind {
  return AGENT_CATALOG_KINDS.includes(value as AgentCatalogKind);
}

export function isAgentCatalogAction(
  value: string,
): value is AgentCatalogAction {
  return AGENT_CATALOG_ACTIONS.includes(value as AgentCatalogAction);
}

export function isProjectAgentKind(value: string): value is ProjectAgentKind {
  return PROJECT_AGENT_KINDS.includes(value as ProjectAgentKind);
}

export function isInstalledProjectAgentKind(
  value: ProjectAgentKind,
): value is "installed_project_agent" {
  return value === "installed_project_agent";
}

export function isProjectAgentExecutionKind(
  value: string,
): value is ProjectAgentExecutionKind {
  return PROJECT_AGENT_EXECUTION_KINDS.includes(
    value as ProjectAgentExecutionKind,
  );
}
