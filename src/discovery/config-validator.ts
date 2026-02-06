/**
 * AI Config Validator
 *
 * Pure validation logic for AI configuration. Returns plain-text messages
 * without ANSI formatting — the CLI caller applies colors when printing.
 */

import type { VeryfrontConfig } from "#veryfront/config";

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export function validateAIConfig(config: VeryfrontConfig): ValidationResult {
  const result: ValidationResult = { valid: true, warnings: [], errors: [] };

  const providers = config.ai?.providers;
  if (!providers) return result;

  for (const [name, providerConfig] of Object.entries(providers)) {
    if (providerConfig.apiKey) continue;

    result.warnings.push(
      `Missing API Key for provider "${name}".\n` +
        `The provider is configured but no API key was found.\n` +
        `Please add ${name.toUpperCase()}_API_KEY to your .env file.`,
    );
  }

  return result;
}
