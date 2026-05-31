export const AGENT_CATALOG_SOURCE_TYPES = [
  "project_agent",
  "catalog_entry",
] as const;

export type AgentCatalogSourceType = (typeof AGENT_CATALOG_SOURCE_TYPES)[number];

export type ProjectAgentCatalogSource = {
  type: "project_agent";
  project_reference: string;
  source_path: string | null;
};

export type CatalogEntryAgentCatalogSource = {
  type: "catalog_entry";
  catalog_entry_id: string;
  project_reference: string | null;
};

export type AgentCatalogSource =
  | ProjectAgentCatalogSource
  | CatalogEntryAgentCatalogSource;

export const AGENT_INSTALL_TARGETS = ["project", "account"] as const;

export type AgentInstallTarget = (typeof AGENT_INSTALL_TARGETS)[number];

export const AGENT_CUSTOMIZATION_MODES = [
  "none",
  "configure",
  "fork_to_project",
] as const;

export type AgentCustomizationMode = (typeof AGENT_CUSTOMIZATION_MODES)[number];

export const AGENT_CATALOG_ACTIONS = [
  "install_to_project",
  "install_to_account",
  "fork_to_project",
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

export function isAgentCatalogSourceType(
  value: string,
): value is AgentCatalogSourceType {
  return AGENT_CATALOG_SOURCE_TYPES.includes(
    value as AgentCatalogSourceType,
  );
}

export function isAgentInstallTarget(
  value: string,
): value is AgentInstallTarget {
  return AGENT_INSTALL_TARGETS.includes(value as AgentInstallTarget);
}

export function isAgentCustomizationMode(
  value: string,
): value is AgentCustomizationMode {
  return AGENT_CUSTOMIZATION_MODES.includes(value as AgentCustomizationMode);
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
