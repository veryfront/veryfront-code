import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { MAX_INTEGRATION_NAME_LENGTH } from "./limits.ts";
import { ALL_INTEGRATION_NAMES } from "./schema.ts";

export const EXPERIMENTAL_INTEGRATIONS_ENV = "VERYFRONT_EXPERIMENTAL_INTEGRATIONS";
export const MAX_EXPERIMENTAL_INTEGRATIONS_ENV_LENGTH = 16_384;

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
const ENABLE_ALL_EXPERIMENTAL_INTEGRATIONS = Symbol("enable-all-experimental-integrations");
const EMPTY_EXPERIMENTAL_INTEGRATIONS = new Set<string>();

type ExperimentalIntegrationSelection =
  | ReadonlySet<string>
  | typeof ENABLE_ALL_EXPERIMENTAL_INTEGRATIONS;

/** Normalize a connector name at public lookup and feature-flag boundaries. */
export function normalizeIntegrationName(name: string): string {
  return name.trim().toLowerCase();
}

function readEnv(name: string): string | undefined {
  return getHostEnv(name);
}

function readExperimentalIntegrationSelection(): ExperimentalIntegrationSelection {
  const value = readEnv(EXPERIMENTAL_INTEGRATIONS_ENV);
  if (!value || value.length > MAX_EXPERIMENTAL_INTEGRATIONS_ENV_LENGTH) {
    return EMPTY_EXPERIMENTAL_INTEGRATIONS;
  }

  const normalizedValue = value.trim().toLowerCase();
  if (["1", "true", "all", "*"].includes(normalizedValue)) {
    return ENABLE_ALL_EXPERIMENTAL_INTEGRATIONS;
  }

  const selected = new Set<string>();
  for (const candidate of normalizedValue.split(",")) {
    const integration = candidate.trim();
    if (declaredIntegrations.has(integration)) selected.add(integration);
  }
  return selected;
}

function isExperimentalIntegrationSelected(
  name: string | null | undefined,
  selection: ExperimentalIntegrationSelection,
): boolean {
  if (typeof name !== "string" || name.length > MAX_INTEGRATION_NAME_LENGTH) return false;
  const normalizedName = normalizeIntegrationName(name);
  if (!declaredIntegrations.has(normalizedName)) return false;
  return selection === ENABLE_ALL_EXPERIMENTAL_INTEGRATIONS ||
    selection.has(normalizedName);
}

export function isDeclaredIntegration(name: string | null | undefined): boolean {
  return typeof name === "string" &&
    name.length <= MAX_INTEGRATION_NAME_LENGTH &&
    declaredIntegrations.has(normalizeIntegrationName(name));
}

export function isSupportedIntegration(name: string | null | undefined): boolean {
  return typeof name === "string" &&
    name.length <= MAX_INTEGRATION_NAME_LENGTH &&
    supportedIntegrations.has(normalizeIntegrationName(name));
}

export function isExperimentalIntegrationEnabled(name: string | null | undefined): boolean {
  return isExperimentalIntegrationSelected(name, readExperimentalIntegrationSelection());
}

export function isVisibleIntegration(name: string | null | undefined): boolean {
  return isSupportedIntegration(name) || isExperimentalIntegrationEnabled(name);
}

export function filterVisibleIntegrations<T extends { id?: string; name?: string }>(
  integrations: readonly T[],
): T[] {
  const experimentalIntegrations = readExperimentalIntegrationSelection();
  return integrations.filter((integration) => {
    const name = integration.id ?? integration.name;
    return isSupportedIntegration(name) ||
      isExperimentalIntegrationSelected(name, experimentalIntegrations);
  });
}
