/**
 * Shared catalog of templates and integrations
 * Single source of truth for all CLI template/integration data
 */

import type { IntegrationName } from "../../templates/types.ts";
import type { InitTemplate } from "./types.ts";
import type { SelectOption } from "../../utils/terminal-select.ts";

// ============================================================================
// Templates
// ============================================================================

export interface TemplateOption {
  id: InitTemplate;
  label: string;
  description: string;
}

export const TEMPLATES: readonly TemplateOption[] = [
  { id: "minimal", label: "Minimal", description: "Blank canvas, no extras" },
  { id: "ai-agent", label: "AI Agent", description: "Agent + chat UI + streaming" },
  {
    id: "docs-agent",
    label: "Docs Agent",
    description: "Document Q&A with source citations",
  },
  {
    id: "agentic-workflow",
    label: "Agentic Workflow",
    description: "Steps + approvals + parallelism",
  },
  {
    id: "multi-agent-system",
    label: "Multi-Agent System",
    description: "Agents that delegate to each other",
  },
  { id: "coding-agent", label: "Coding Agent", description: "AI code assistant with file tools" },
  { id: "saas-starter", label: "SaaS Starter", description: "Auth + chat + per-user memory" },
] as const;

/** Get templates as SelectOption[] for terminal-select */
export function getTemplateSelectOptions(): SelectOption[] {
  return TEMPLATES.map((t) => ({
    value: t.id,
    label: t.label,
    description: t.description,
  }));
}

// ============================================================================
// Integrations
// ============================================================================

export interface IntegrationOption {
  id: IntegrationName;
  label: string;
  description: string;
}

export interface IntegrationCategory {
  name: string;
  integrations: readonly IntegrationOption[];
}

export const INTEGRATION_CATEGORIES: readonly IntegrationCategory[] = [
  {
    name: "Communication",
    integrations: [
      { id: "gmail", label: "Gmail", description: "Read, search, send emails" },
      { id: "slack", label: "Slack", description: "Messages, channels, search" },
      { id: "outlook", label: "Outlook", description: "Email via Microsoft Graph" },
      { id: "teams", label: "Teams", description: "Chat, meetings" },
    ],
  },
  {
    name: "Productivity",
    integrations: [
      { id: "calendar", label: "Calendar", description: "Google Calendar events" },
      { id: "notion", label: "Notion", description: "Pages, databases, blocks" },
      { id: "jira", label: "Jira", description: "Issues, projects, sprints" },
      { id: "linear", label: "Linear", description: "Issue tracking" },
      { id: "asana", label: "Asana", description: "Tasks, projects" },
      { id: "confluence", label: "Confluence", description: "Wiki pages, spaces" },
    ],
  },
  {
    name: "Development",
    integrations: [
      { id: "github", label: "GitHub", description: "Repos, issues, PRs, actions" },
      { id: "gitlab", label: "GitLab", description: "Repos, merge requests, pipelines" },
    ],
  },
  {
    name: "Storage",
    integrations: [
      { id: "drive", label: "Google Drive", description: "Files, folders" },
      { id: "docs-google", label: "Google Docs", description: "Documents" },
      { id: "sheets", label: "Google Sheets", description: "Spreadsheets" },
      { id: "onedrive", label: "OneDrive", description: "Microsoft files" },
      { id: "sharepoint", label: "SharePoint", description: "Enterprise content" },
      { id: "airtable", label: "Airtable", description: "Database, spreadsheet" },
    ],
  },
  {
    name: "Design",
    integrations: [{ id: "figma", label: "Figma", description: "Design files, comments" }],
  },
] as const;

/** Get all integrations as a flat array */
export function getAllIntegrations(): IntegrationOption[] {
  return INTEGRATION_CATEGORIES.flatMap((cat) => [...cat.integrations]);
}

/** Get integrations as SelectOption[] for terminal-select */
export function getIntegrationSelectOptions(): SelectOption[] {
  return getAllIntegrations().map((i) => ({
    value: i.id,
    label: i.label,
    description: i.description,
  }));
}

/** Get popular integrations (subset for quick selection) */
export function getPopularIntegrations(): IntegrationOption[] {
  const popular: IntegrationName[] = [
    "gmail",
    "slack",
    "notion",
    "github",
    "calendar",
    "drive",
    "jira",
    "linear",
  ];
  const all = getAllIntegrations();
  return popular.map((id) => all.find((i) => i.id === id)!).filter(Boolean);
}

/** Get integrations as SelectOption[] with category headers */
export function getIntegrationSelectOptionsWithHeaders(): Array<
  SelectOption & { isHeader?: boolean }
> {
  const choices: Array<SelectOption & { isHeader?: boolean }> = [];

  for (const category of INTEGRATION_CATEGORIES) {
    choices.push({
      value: `__header_${category.name}`,
      label: `── ${category.name} ──`,
      description: "",
      isHeader: true,
    });

    for (const integration of category.integrations) {
      choices.push({
        value: integration.id,
        label: integration.label,
        description: integration.description,
      });
    }
  }

  return choices;
}
