import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { ALL_INTEGRATION_NAMES } from "./schema.ts";

export const EXPERIMENTAL_INTEGRATIONS_ENV = "VERYFRONT_EXPERIMENTAL_INTEGRATIONS";

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
 * Every integration the framework recognizes. Declared === registered: this is
 * the full catalog, so it derives from the canonical {@link ALL_INTEGRATION_NAMES}
 * registry rather than maintaining a parallel copy that can drift out of sync.
 */
export const DECLARED_INTEGRATION_NAMES = ALL_INTEGRATION_NAMES;

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
