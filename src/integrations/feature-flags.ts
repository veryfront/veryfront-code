import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { ALL_INTEGRATION_NAMES } from "./schema.ts";

export const EXPERIMENTAL_INTEGRATIONS_ENV = "VERYFRONT_EXPERIMENTAL_INTEGRATIONS";

/**
 * The subset of {@link ALL_INTEGRATION_NAMES} that ships visible by default.
 * This is a deliberate curation, not the full registry. Every entry must stay
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

Object.freeze(SUPPORTED_INTEGRATION_NAMES);

/**
 * Every integration name accepted by framework configuration. Compatibility-reserved
 * names can remain here after their catalog source is removed, so catalog lookup
 * remains the authority for connector availability.
 */
export const DECLARED_INTEGRATION_NAMES = ALL_INTEGRATION_NAMES;

const supportedIntegrations = new Set<string>(SUPPORTED_INTEGRATION_NAMES);
const declaredIntegrations = new Set<string>(DECLARED_INTEGRATION_NAMES);
const ENABLE_ALL_VALUES = new Set(["1", "true", "all", "*"]);
const MAX_INTEGRATION_NAME_LENGTH = 128;
const MAX_EXPERIMENTAL_FLAG_LENGTH = 8_192;
const MAX_EXPERIMENTAL_FLAG_ENTRIES = declaredIntegrations.size;
let hasCachedExperimentalFlag = false;
let cachedExperimentalFlag: string | undefined;
let cachedExperimentalSelection: {
  readonly enableAll: boolean;
  readonly names: ReadonlySet<string>;
} = { enableAll: false, names: new Set() };

/** Normalize a catalog lookup without accepting unbounded input. */
export function normalizeIntegrationName(name: string): string {
  if (name.length > MAX_INTEGRATION_NAME_LENGTH) return "";
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

function getExperimentalSelection(): {
  readonly enableAll: boolean;
  readonly names: ReadonlySet<string>;
} {
  const value = readEnv(EXPERIMENTAL_INTEGRATIONS_ENV);
  if (!hasCachedExperimentalFlag || value !== cachedExperimentalFlag) {
    hasCachedExperimentalFlag = true;
    cachedExperimentalFlag = value;
    let enableAll = false;
    let names: ReadonlySet<string> = new Set();

    if (value && value.length <= MAX_EXPERIMENTAL_FLAG_LENGTH) {
      const normalizedValue = value.trim().toLowerCase();
      if (ENABLE_ALL_VALUES.has(normalizedValue)) {
        enableAll = true;
      } else {
        const entries = normalizedValue.split(",");
        if (entries.length <= MAX_EXPERIMENTAL_FLAG_ENTRIES) {
          names = new Set(
            entries
              .map((item) => normalizeIntegrationName(item))
              .filter((item) => item.length > 0 && declaredIntegrations.has(item)),
          );
        }
      }
    }
    cachedExperimentalSelection = { enableAll, names };
  }
  return cachedExperimentalSelection;
}

export function isExperimentalIntegrationEnabled(name: string | null | undefined): boolean {
  if (typeof name !== "string" || !isDeclaredIntegration(name)) return false;

  const normalizedName = normalizeIntegrationName(name);
  const selection = getExperimentalSelection();
  return selection.enableAll || selection.names.has(normalizedName);
}

export function isVisibleIntegration(name: string | null | undefined): boolean {
  return isSupportedIntegration(name) || isExperimentalIntegrationEnabled(name);
}

export function filterVisibleIntegrations<T extends { id?: string; name?: string }>(
  integrations: readonly T[],
): T[] {
  const experimentalSelection = getExperimentalSelection();
  return integrations.filter((integration) => {
    const candidate = integration.id ?? integration.name;
    if (typeof candidate !== "string") return false;
    const normalizedName = normalizeIntegrationName(candidate);
    return supportedIntegrations.has(normalizedName) ||
      (declaredIntegrations.has(normalizedName) &&
        (experimentalSelection.enableAll || experimentalSelection.names.has(normalizedName)));
  });
}
