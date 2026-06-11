/**
 * Shared catalog of templates and integrations
 * Single source of truth for all CLI template/integration data
 */

import type { IntegrationName } from "../../templates/types.ts";
import type { InitTemplate } from "./types.ts";
import type { SelectOption } from "../../utils/terminal-select.ts";
import {
  filterVisibleIntegrations,
  isVisibleIntegration,
} from "../../../src/integrations/feature-flags.ts";

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
      { id: "webex", label: "Webex", description: "Messaging, meetings" },
      { id: "zoom", label: "Zoom", description: "Meetings, webinars" },
      { id: "google-chat", label: "Google Chat", description: "Spaces, messages" },
      { id: "dialpad", label: "Dialpad", description: "Calls, SMS" },
      { id: "twilio", label: "Twilio", description: "SMS, voice" },
    ],
  },
  {
    name: "Productivity",
    integrations: [
      { id: "calendar", label: "Google Calendar", description: "Google Calendar events" },
      { id: "notion", label: "Notion", description: "Pages, databases, blocks" },
      { id: "jira", label: "Jira", description: "Issues, projects, sprints" },
      { id: "linear", label: "Linear", description: "Issue tracking" },
      { id: "asana", label: "Asana", description: "Tasks, projects" },
      { id: "trello", label: "Trello", description: "Boards, lists, cards" },
      { id: "monday", label: "Monday", description: "Work management" },
      { id: "clickup", label: "ClickUp", description: "Tasks, docs" },
      { id: "todoist", label: "Todoist", description: "Tasks, projects" },
      { id: "coda", label: "Coda", description: "Docs, tables" },
      { id: "basecamp", label: "Basecamp", description: "Projects, to-dos" },
      { id: "shortcut", label: "Shortcut", description: "Stories, epics" },
      { id: "productboard", label: "Productboard", description: "Product feedback, roadmaps" },
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
      { id: "circleci", label: "CircleCI", description: "CI/CD pipelines" },
      { id: "buildkite", label: "Buildkite", description: "CI/CD pipelines" },
      { id: "snyk", label: "Snyk", description: "Vulnerability scanning" },
      { id: "launchdarkly", label: "LaunchDarkly", description: "Feature flags" },
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
      { id: "vercel", label: "Vercel", description: "Deployments, projects" },
      { id: "netlify", label: "Netlify", description: "Sites, deploys" },
      { id: "railway", label: "Railway", description: "Projects, deployments" },
      { id: "render", label: "Render", description: "Services, deploys" },
      { id: "fly-io", label: "Fly.io", description: "Apps, machines" },
      { id: "heroku", label: "Heroku", description: "Apps, dynos" },
      { id: "digitalocean", label: "DigitalOcean", description: "Droplets, databases" },
      { id: "cloudflare", label: "Cloudflare", description: "Zones, DNS" },
      { id: "mongodb-atlas", label: "MongoDB Atlas", description: "Clusters, databases" },
      { id: "planetscale", label: "PlanetScale", description: "MySQL branches" },
      { id: "clickhouse", label: "ClickHouse", description: "Cloud analytics DB" },
      { id: "redis-cloud", label: "Redis Cloud", description: "Managed Redis" },
      { id: "aws", label: "AWS", description: "S3, Lambda, DynamoDB" },
    ],
  },
  {
    name: "Sales & CRM",
    integrations: [
      { id: "hubspot", label: "HubSpot", description: "Forms, contacts, and leads" },
      { id: "salesforce", label: "Salesforce", description: "CRM, sales automation" },
      { id: "attio", label: "Attio", description: "Modern CRM" },
      { id: "close", label: "Close", description: "Sales CRM, calls" },
      { id: "apollo", label: "Apollo.io", description: "Prospecting, enrichment" },
      { id: "activecampaign", label: "ActiveCampaign", description: "CRM, automation" },
      { id: "folk", label: "folk", description: "Lightweight CRM" },
      { id: "salesflare", label: "Salesflare", description: "CRM for small teams" },
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
      { id: "paypal", label: "PayPal", description: "Transactions, invoices" },
      { id: "square", label: "Square", description: "Payments, orders" },
      { id: "razorpay", label: "Razorpay", description: "Payments (India)" },
      { id: "quickbooks", label: "QuickBooks", description: "Accounting" },
      { id: "xero", label: "Xero", description: "Accounting" },
    ],
  },
  {
    name: "Marketing",
    integrations: [
      { id: "mailchimp", label: "Mailchimp", description: "Email marketing" },
      { id: "shopify", label: "Shopify", description: "E-commerce" },
      { id: "klaviyo", label: "Klaviyo", description: "Email & SMS marketing" },
      { id: "sendgrid", label: "SendGrid", description: "Transactional email" },
      { id: "brevo", label: "Brevo", description: "Email campaigns, contacts" },
      { id: "resend", label: "Resend", description: "Developer email" },
      { id: "typeform", label: "Typeform", description: "Forms, responses" },
      { id: "jotform", label: "Jotform", description: "Forms, submissions" },
      { id: "twitter", label: "Twitter/X", description: "Social media" },
    ],
  },
  {
    name: "Design",
    integrations: [{ id: "figma", label: "Figma", description: "Design files, comments" }],
  },
  {
    name: "AI Providers",
    integrations: [
      { id: "anthropic", label: "Anthropic", description: "Claude models" },
      { id: "openai", label: "OpenAI", description: "GPT models, embeddings, images" },
      { id: "gemini", label: "Gemini", description: "Google Gemini models" },
      { id: "mistral", label: "Mistral", description: "Mistral models" },
      { id: "perplexity", label: "Perplexity", description: "Search-grounded answers" },
      { id: "cohere", label: "Cohere", description: "Chat, embeddings, rerank" },
      { id: "groq", label: "Groq", description: "Fast LLM inference" },
      { id: "together-ai", label: "Together AI", description: "Open-model inference" },
      { id: "fireworks-ai", label: "Fireworks AI", description: "Open-model inference" },
      { id: "openrouter", label: "OpenRouter", description: "Multi-provider LLM routing" },
      { id: "replicate", label: "Replicate", description: "Hosted model predictions" },
      { id: "huggingface", label: "Hugging Face", description: "Hub models, inference" },
      { id: "elevenlabs", label: "ElevenLabs", description: "Voice synthesis" },
      { id: "deepgram", label: "Deepgram", description: "Speech-to-text" },
      { id: "assemblyai", label: "AssemblyAI", description: "Speech-to-text" },
      { id: "stability-ai", label: "Stability AI", description: "Image generation" },
      { id: "fal", label: "fal", description: "Generative media inference" },
    ],
  },
  {
    name: "AI Infrastructure",
    integrations: [
      { id: "langsmith", label: "LangSmith", description: "LLM tracing, datasets" },
      { id: "langfuse", label: "Langfuse", description: "LLM observability" },
      { id: "pinecone", label: "Pinecone", description: "Vector database" },
      { id: "qdrant", label: "Qdrant", description: "Vector database" },
      { id: "weaviate", label: "Weaviate", description: "Vector database" },
      { id: "browserbase", label: "Browserbase", description: "Headless browsers" },
      { id: "apify", label: "Apify", description: "Web scraping actors" },
    ],
  },
  {
    name: "Search & Web Data",
    integrations: [
      { id: "algolia", label: "Algolia", description: "Search indexes" },
      { id: "exa", label: "Exa", description: "Neural web search" },
      { id: "tavily", label: "Tavily", description: "Search for agents" },
      { id: "firecrawl", label: "Firecrawl", description: "Scrape & crawl" },
    ],
  },
  {
    name: "Observability",
    integrations: [
      { id: "datadog", label: "Datadog", description: "Monitors, metrics, logs" },
      { id: "pagerduty", label: "PagerDuty", description: "Incidents, on-call" },
      { id: "grafana-cloud", label: "Grafana Cloud", description: "Dashboards" },
      { id: "new-relic", label: "New Relic", description: "NRQL, entities" },
      { id: "axiom", label: "Axiom", description: "Log analytics" },
      { id: "betterstack", label: "Better Stack", description: "Uptime monitoring" },
      { id: "checkly", label: "Checkly", description: "Synthetic monitoring" },
    ],
  },
  {
    name: "Data & Analytics",
    integrations: [
      { id: "google-analytics", label: "Google Analytics", description: "GA4 reports" },
      { id: "amplitude", label: "Amplitude", description: "Product analytics" },
      { id: "segment", label: "Segment", description: "Customer data platform" },
      { id: "metabase", label: "Metabase", description: "BI queries, dashboards" },
    ],
  },
  {
    name: "Scheduling & Meetings",
    integrations: [
      { id: "calendly", label: "Calendly", description: "Scheduling links, events" },
      { id: "fireflies", label: "Fireflies", description: "Meeting transcripts" },
      { id: "fathom", label: "Fathom", description: "Meeting summaries" },
      { id: "gong", label: "Gong", description: "Call intelligence" },
    ],
  },
  {
    name: "HR & Recruiting",
    integrations: [
      { id: "gusto", label: "Gusto", description: "Payroll, employees" },
      { id: "ashby", label: "Ashby", description: "ATS, candidates" },
      { id: "lever", label: "Lever", description: "ATS, opportunities" },
    ],
  },
] as const;

/** Get all integrations as a flat array */
export function getAllIntegrations(): IntegrationOption[] {
  return filterVisibleIntegrations(
    INTEGRATION_CATEGORIES.flatMap((cat) => [...cat.integrations]),
  );
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
    const integrations = category.integrations.filter((integration) =>
      isVisibleIntegration(integration.id)
    );
    if (integrations.length === 0) continue;

    choices.push({
      value: `__header_${category.name}`,
      label: `── ${category.name} ──`,
      description: "",
      isHeader: true,
    });

    for (const integration of integrations) {
      choices.push({
        value: integration.id,
        label: integration.label,
        description: integration.description,
      });
    }
  }

  return choices;
}
