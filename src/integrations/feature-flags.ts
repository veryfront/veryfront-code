import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { ALL_INTEGRATION_NAMES } from "./schema.ts";

export const EXPERIMENTAL_INTEGRATIONS_ENV = "VERYFRONT_EXPERIMENTAL_INTEGRATIONS";
/** Env var naming adapter-only connectors the host drives with its own client. */
export const HOST_ADAPTER_INTEGRATIONS_ENV = "VERYFRONT_HOST_ADAPTER_INTEGRATIONS";

/**
 * The subset of {@link ALL_INTEGRATION_NAMES} that ships visible by default.
 * This is a deliberate curation, not the full registry — every entry must stay
 * a canonical integration name, which feature-flags.test.ts enforces.
 */
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

/**
 * Declared connectors whose OAuth wire protocol is not implemented by the
 * generic runtime. A feature flag must not make these scaffoldable: doing so
 * would generate routes that fail as soon as their provider config is loaded.
 */
export const INTEGRATIONS_REQUIRING_PROVIDER_ADAPTER = [
  "box",
  "clickup",
  "freshdesk",
  "intercom",
  "mailchimp",
  "monday",
  "pipedrive",
  "quickbooks",
  "salesforce",
  "shopify",
  "trello",
  "xero",
] as const;

/**
 * Every integration the framework recognizes. Declared === registered: this is
 * the full catalog, so it derives from the canonical {@link ALL_INTEGRATION_NAMES}
 * registry rather than maintaining a parallel copy that can drift out of sync.
 */
export const DECLARED_INTEGRATION_NAMES = ALL_INTEGRATION_NAMES;

const supportedIntegrations = new Set<string>(SUPPORTED_INTEGRATION_NAMES);
const declaredIntegrations = new Set<string>(DECLARED_INTEGRATION_NAMES);
const providerAdapterRequiredIntegrations = new Set<string>(
  INTEGRATIONS_REQUIRING_PROVIDER_ADAPTER,
);

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

export function requiresProviderAdapter(name: string | null | undefined): boolean {
  return typeof name === "string" &&
    providerAdapterRequiredIntegrations.has(normalizeIntegrationName(name));
}

export function isExperimentalIntegrationEnabled(name: string | null | undefined): boolean {
  if (
    typeof name !== "string" || !isDeclaredIntegration(name) || requiresProviderAdapter(name)
  ) return false;

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

/**
 * Adapter-only connectors the embedding host declares it drives with its own
 * client. Only {@link isCatalogVisibleIntegration} honours this: scaffolding
 * keeps refusing them, because generated routes run on the generic runtime and
 * that is precisely what cannot serve them. Blanket values are ignored, so a
 * host has to name each connector it actually implements.
 */
export function isHostAdapterIntegration(name: string | null | undefined): boolean {
  if (
    typeof name !== "string" || !isDeclaredIntegration(name) || !requiresProviderAdapter(name)
  ) return false;

  const value = readEnv(HOST_ADAPTER_INTEGRATIONS_ENV);
  if (!value) return false;

  const normalizedName = normalizeIntegrationName(name);
  return value
    .trim()
    .toLowerCase()
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .includes(normalizedName);
}

/**
 * Visibility for catalog lookup. Wider than {@link isVisibleIntegration}: a
 * host that supplies its own adapter still needs the connector definitions,
 * otherwise it has a working integration with no tools.
 */
export function isCatalogVisibleIntegration(name: string | null | undefined): boolean {
  return isVisibleIntegration(name) || isHostAdapterIntegration(name);
}

export function filterCatalogVisibleIntegrations<T extends { id?: string; name?: string }>(
  integrations: readonly T[],
): T[] {
  return integrations.filter((integration) =>
    isCatalogVisibleIntegration(integration.id ?? integration.name)
  );
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
