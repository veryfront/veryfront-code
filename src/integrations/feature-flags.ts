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
] as const;

const supportedIntegrations = new Set<string>(SUPPORTED_INTEGRATION_NAMES);
const declaredIntegrations = new Set<string>(DECLARED_INTEGRATION_NAMES);

function normalizeIntegrationName(name: string): string {
  return name.trim().toLowerCase();
}

function readEnv(name: string): string | undefined {
  try {
    return globalThis.Deno?.env?.get(name);
  } catch {
    // Deno throws without --allow-env. Treat missing permission like an unset flag.
  }

  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  return processEnv?.[name];
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
