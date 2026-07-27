/**
 * Provider Config Validator
 *
 * Pure validation logic for configured model providers. Returns plain-text
 * messages without ANSI formatting; the CLI caller applies colors when printing.
 */

import type { VeryfrontConfig } from "#veryfront/config";

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

function compareProviderNames(
  [left]: readonly [string, unknown],
  [right]: readonly [string, unknown],
): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function providerLabel(name: string): string {
  const bounded = name.length > 128 ? `${name.slice(0, 128)}…` : name;
  return JSON.stringify(bounded).replace(
    /[\u007f-\u009f\u2028\u2029]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function providerEnvironmentVariable(name: string): string {
  const segment = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return `${segment || "PROVIDER"}_API_KEY`;
}

export function validateProviderConfig(config: VeryfrontConfig): ValidationResult {
  const result: ValidationResult = { valid: true, warnings: [], errors: [] };

  const providers = config.ai?.providers;
  if (!providers) return result;

  for (const [name, providerConfig] of Object.entries(providers).sort(compareProviderNames)) {
    if (
      typeof providerConfig.apiKey === "string" &&
      providerConfig.apiKey.trim().length > 0
    ) {
      continue;
    }

    result.warnings.push(
      `Missing API Key for provider ${providerLabel(name)}.\n` +
        `The provider is configured but no API key was found.\n` +
        `Please add ${providerEnvironmentVariable(name)} to your .env file.`,
    );
  }

  return result;
}
