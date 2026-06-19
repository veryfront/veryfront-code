import { getHostEnv } from "#veryfront/platform/compat/process.ts";

export const EXPERIMENTAL_INTEGRATIONS_ENV = "VERYFRONT_EXPERIMENTAL_INTEGRATIONS";

export const SUPPORTED_INTEGRATION_NAMES = [
  "airtable",
  "asana",
  "calendar",
  "confluence",
  "docs-google",
  "drive",
  "figma",
  "github",
  "gitlab",
  "gmail",
  "harvest",
  "hubspot",
  "jira",
  "linear",
  "notion",
  "onedrive",
  "outlook",
  "sentry",
  "sharepoint",
  "sheets",
  "slack",
  "teams",
] as const;

export const DECLARED_INTEGRATION_NAMES = [
  "gmail",
  "slack",
  "github",
  "calendar",
  "jira",
  "notion",
  "servicenow",
  "confluence",
  "linear",
  "gitlab",
  "outlook",
  "teams",
  "figma",
  "sap",
  "sheets",
  "airtable",
  "supabase",
  "neon",
  "sharepoint",
  "stripe",
  "salesforce",
  "twitter",
  "onedrive",
  "bitbucket",
  "sentry",
  "posthog",
  "persona",
  "zendesk",
  "asana",
  "harvest",
  "monday",
  "zoom",
  "trello",
  "box",
  "shopify",
  "clickup",
  "intercom",
  "pipedrive",
  "mailchimp",
  "webex",
  "freshdesk",
  "quickbooks",
  "xero",
  "drive",
  "docs-google",
  "snowflake",
  "mixpanel",
  "twilio",
  "anthropic",
  "aws",
  "hubspot",
  "openai",
  "todoist",
  "calendly",
  "google-analytics",
  "klaviyo",
  "datadog",
  "paypal",
  "activecampaign",
  "algolia",
  "amplitude",
  "apollo",
  "ashby",
  "attio",
  "basecamp",
  "brevo",
  "circleci",
  "close",
  "cloudflare",
  "coda",
  "dialpad",
  "digitalocean",
  "exa",
  "fathom",
  "firecrawl",
  "fireflies",
  "folk",
  "gemini",
  "gong",
  "google-chat",
  "gusto",
  "jotform",
  "lever",
  "metabase",
  "mistral",
  "pagerduty",
  "perplexity",
  "productboard",
  "razorpay",
  "resend",
  "salesflare",
  "segment",
  "sendgrid",
  "shortcut",
  "square",
  "tavily",
  "typeform",
  "apify",
  "assemblyai",
  "axiom",
  "betterstack",
  "browserbase",
  "buildkite",
  "checkly",
  "clickhouse",
  "cohere",
  "deepgram",
  "elevenlabs",
  "fal",
  "fireworks-ai",
  "fly-io",
  "grafana-cloud",
  "groq",
  "heroku",
  "huggingface",
  "langfuse",
  "langsmith",
  "launchdarkly",
  "mongodb-atlas",
  "netlify",
  "new-relic",
  "openrouter",
  "pinecone",
  "planetscale",
  "qdrant",
  "railway",
  "redis-cloud",
  "render",
  "replicate",
  "snyk",
  "stability-ai",
  "together-ai",
  "vercel",
  "weaviate",
  "bamboohr",
  "cal-com",
  "customer-io",
  "discord",
  "docusign",
  "gocardless",
  "google-bigquery",
  "google-contacts",
  "help-scout",
  "telegram",
  "whatsapp",
  "woocommerce",
  "zoho-crm",
  "adyen",
  "azure-blob-storage",
  "bigcommerce",
  "brave-search",
  "chargebee",
  "databricks",
  "deel",
  "front",
  "google-cloud-storage",
  "google-forms",
  "gorgias",
  "greenhouse",
  "guru",
  "mollie",
  "paddle",
  "pandadoc",
  "personio",
  "portkey",
  "power-bi",
  "ramp",
  "rippling",
  "serpapi",
  "shopware",
  "surveymonkey",
  "tally",
  "wix",
  "workable",
  "azure",
  "azure-document-intelligence",
  "billbee",
  "cleverreach",
  "datev",
  "factorial",
  "finapi",
  "gcp",
  "hetzner",
  "ionos",
  "klarna",
  "lexoffice",
  "mindee",
  "moss",
  "neo4j",
  "north-data",
  "qonto",
  "sendcloud",
  "sevdesk",
  "skribble",
  "stackit",
  "trusted-shops",
  "unstructured",
  "unzer",
  "voyage-ai",
  "xentral",
  "alphavantage",
  "daytona",
  "e2b",
  "polygon",
  "sprites",
] as const;

const supportedIntegrations = new Set<string>(SUPPORTED_INTEGRATION_NAMES);
const declaredIntegrations = new Set<string>(DECLARED_INTEGRATION_NAMES);

function normalizeIntegrationName(name: string): string {
  return name.trim().toLowerCase();
}

function readEnv(name: string): string | undefined {
  return getHostEnv(name);
}

export function isDeclaredIntegration(name: string | null | undefined): boolean {
  return typeof name === "string" && declaredIntegrations.has(normalizeIntegrationName(name));
}

export function isSupportedIntegration(name: string | null | undefined): boolean {
  return typeof name === "string" && supportedIntegrations.has(normalizeIntegrationName(name));
}

export function isExperimentalIntegrationEnabled(name: string | null | undefined): boolean {
  if (typeof name !== "string" || !isDeclaredIntegration(name)) return false;

  const value = readEnv(EXPERIMENTAL_INTEGRATIONS_ENV);
  if (!value) return false;

  const normalizedName = normalizeIntegrationName(name);
  const normalizedValue = value.trim().toLowerCase();
  if (["1", "true", "all", "*"].includes(normalizedValue)) return true;

  return normalizedValue
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .includes(normalizedName);
}

export function isVisibleIntegration(name: string | null | undefined): boolean {
  return isSupportedIntegration(name) || isExperimentalIntegrationEnabled(name);
}

export function filterVisibleIntegrations<T extends { id?: string; name?: string }>(
  integrations: readonly T[],
): T[] {
  return integrations.filter((integration) =>
    isVisibleIntegration(integration.id ?? integration.name)
  );
}
