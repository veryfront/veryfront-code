/**
 * Provider Config Validator
 *
 * Pure validation logic for configured model providers. Returns plain-text
 * messages without ANSI formatting; the CLI caller applies colors when printing.
 */

import type { VeryfrontConfig } from "#veryfront/config";

/** Provider credential validation outcome for CLI startup diagnostics. */
export interface ValidationResult {
  /** Whether no blocking provider configuration errors were found. */
  valid: boolean;
  /** Non-blocking, user-actionable credential warnings. */
  warnings: string[];
  /** Blocking provider configuration shape and readability errors. */
  errors: string[];
}

const CREDENTIAL_FREE_PROVIDERS = new Set(["local", "veryfront-cloud"]);
const PROVIDER_ENV_VARS: Readonly<Record<string, readonly string[]>> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: ["GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
};
const SAFE_PROVIDER_NAME = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_CONFIGURED_PROVIDERS = 128;
const UNREADABLE_PROPERTY = Symbol("unreadable-provider-property");

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  try {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

function readProperty(
  value: Record<PropertyKey, unknown>,
  property: PropertyKey,
): unknown | typeof UNREADABLE_PROPERTY {
  try {
    return Reflect.get(value, property);
  } catch {
    return UNREADABLE_PROPERTY;
  }
}

function addConfigurationError(result: ValidationResult, message: string): void {
  result.valid = false;
  result.errors.push(message);
}

function missingCredentialWarning(name: string): string {
  const safeName = SAFE_PROVIDER_NAME.test(name) ? `Provider "${name}"` : "A custom provider";
  const envVars = Object.hasOwn(PROVIDER_ENV_VARS, name) ? PROVIDER_ENV_VARS[name] : undefined;
  if (!envVars) {
    return `${safeName} has no API key. Set its apiKey in your Veryfront configuration.`;
  }

  return `${safeName} has no API key. Set ${envVars.join(" or ")} in your environment.`;
}

/** Validate provider configuration and return diagnostics without exposing secrets. */
export function validateProviderConfig(config: VeryfrontConfig): ValidationResult {
  const result: ValidationResult = { valid: true, warnings: [], errors: [] };

  if (!isRecord(config)) {
    addConfigurationError(result, "Provider configuration must be an object.");
    return result;
  }
  const ai = readProperty(config, "ai");
  if (ai === UNREADABLE_PROPERTY) {
    addConfigurationError(result, "Provider configuration must be readable.");
    return result;
  }
  if (ai === undefined) return result;
  if (!isRecord(ai)) {
    addConfigurationError(result, "AI provider configuration must be an object.");
    return result;
  }

  const providers = readProperty(ai, "providers");
  if (providers === UNREADABLE_PROPERTY) {
    addConfigurationError(result, "Provider definitions must be readable.");
    return result;
  }
  if (providers === undefined) return result;
  if (!isRecord(providers)) {
    addConfigurationError(result, "Provider definitions must be an object.");
    return result;
  }

  let entries: Array<[string, unknown]>;
  try {
    entries = Object.entries(providers);
  } catch {
    addConfigurationError(result, "Provider definitions must be readable.");
    return result;
  }
  if (entries.length > MAX_CONFIGURED_PROVIDERS) {
    addConfigurationError(result, "Provider count exceeds the supported limit.");
    return result;
  }

  for (const [name, providerConfig] of entries) {
    if (!isRecord(providerConfig)) {
      addConfigurationError(result, "Each provider definition must be an object.");
      continue;
    }
    const apiKey = readProperty(providerConfig, "apiKey");
    if (apiKey === UNREADABLE_PROPERTY) {
      addConfigurationError(result, "Provider credentials must be readable.");
      continue;
    }
    if (apiKey || CREDENTIAL_FREE_PROVIDERS.has(name)) continue;
    result.warnings.push(missingCredentialWarning(name));
  }

  return result;
}
