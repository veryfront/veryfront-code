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
    id: "ai-rag-agent",
    label: "AI RAG Agent",
    description: "RAG with source citations",
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
      { id: "discord", label: "Discord", description: "Messages, server management" },
      { id: "webex", label: "Webex", description: "Messaging, meetings" },
      { id: "zoom", label: "Zoom", description: "Meetings, webinars" },
      { id: "twilio", label: "Twilio", description: "SMS, voice" },
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
      { id: "trello", label: "Trello", description: "Boards, lists, cards" },
      { id: "monday", label: "Monday", description: "Work management" },
      { id: "clickup", label: "ClickUp", description: "Tasks, docs" },
      { id: "confluence", label: "Confluence", description: "Wiki pages, spaces" },
    ],
  },
  {
    name: "Development",
    integrations: [
      { id: "github", label: "GitHub", description: "Repos, issues, PRs, actions" },
      { id: "gitlab", label: "GitLab", description: "Repos, merge requests, pipelines" },
      { id: "bitbucket", label: "Bitbucket", description: "Repos, pull requests" },
      { id: "sentry", label: "Sentry", description: "Error tracking" },
      { id: "posthog", label: "PostHog", description: "Product analytics" },
      { id: "mixpanel", label: "Mixpanel", description: "Analytics, events" },
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
      { id: "dropbox", label: "Dropbox", description: "File storage" },
      { id: "box", label: "Box", description: "Enterprise files" },
      { id: "airtable", label: "Airtable", description: "Database, spreadsheet" },
    ],
  },
  {
    name: "Infrastructure",
    integrations: [
      { id: "supabase", label: "Supabase", description: "Postgres, auth, storage" },
      { id: "neon", label: "Neon", description: "Serverless Postgres" },
      { id: "snowflake", label: "Snowflake", description: "Data warehouse" },
      { id: "aws", label: "AWS", description: "S3, Lambda, DynamoDB" },
    ],
  },
  {
    name: "Sales & CRM",
    integrations: [
      { id: "salesforce", label: "Salesforce", description: "CRM, sales automation" },
      { id: "hubspot", label: "HubSpot", description: "Marketing, sales" },
      { id: "pipedrive", label: "Pipedrive", description: "Sales pipeline" },
    ],
  },
  {
    name: "Support",
    integrations: [
      { id: "zendesk", label: "Zendesk", description: "Tickets, support" },
      { id: "intercom", label: "Intercom", description: "Customer messaging" },
      { id: "freshdesk", label: "Freshdesk", description: "Help desk" },
      { id: "servicenow", label: "ServiceNow", description: "IT service management" },
    ],
  },
  {
    name: "Finance",
    integrations: [
      { id: "stripe", label: "Stripe", description: "Payments, subscriptions" },
      { id: "quickbooks", label: "QuickBooks", description: "Accounting" },
      { id: "xero", label: "Xero", description: "Accounting" },
    ],
  },
  {
    name: "Marketing",
    integrations: [
      { id: "mailchimp", label: "Mailchimp", description: "Email marketing" },
      { id: "shopify", label: "Shopify", description: "E-commerce" },
      { id: "twitter", label: "Twitter/X", description: "Social media" },
    ],
  },
  {
    name: "Design",
    integrations: [{ id: "figma", label: "Figma", description: "Design files, comments" }],
  },
  {
    name: "AI Providers",
    integrations: [{ id: "anthropic", label: "Anthropic", description: "Claude models" }],
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
