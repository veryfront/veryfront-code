import { cliLogger as logger } from "@veryfront/utils";
import { bold, yellow, red, cyan } from "@veryfront/compat/console";
import type { VeryfrontConfig } from "../../core/config/types.ts";

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Validates the AI configuration and environment setup
 * Checks for missing API keys and other common misconfigurations
 */
export function validateAIConfig(config: VeryfrontConfig): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    warnings: [],
    errors: [],
  };

  // Skip if AI is not configured at all (implicit opt-out)
  if (!config.ai || !config.ai.providers) {
    return result;
  }

  const providers = config.ai.providers;

  for (const [name, providerConfig] of Object.entries(providers)) {
    // Check for API key
    if (!providerConfig.apiKey) {
      result.warnings.push(
        `Missing API Key for provider "${bold(name)}".\n` +
        `The provider is configured but no API key was found.\n` +
        `Please add ${cyan(`${name.toUpperCase()}_API_KEY`)} to your .env file.`
      );
    }
  }

  return result;
}

/**
 * Runs the validation and prints formatted output to the console
 */
export function runAIConfigValidation(config: VeryfrontConfig): void {
  const result = validateAIConfig(config);

  if (result.warnings.length > 0) {
    console.log(""); // Spacing
    logger.warn(`${yellow("AI Configuration Warning")}:`);
    for (const warning of result.warnings) {
      console.log(`  ${yellow("!")} ${warning.replace(/\n/g, "\n    ")}`);
    }
    console.log(""); // Spacing
  }

  if (result.errors.length > 0) {
    console.log(""); // Spacing
    logger.error(`${red("AI Configuration Error")}:`);
    for (const error of result.errors) {
      console.log(`  ${red("x")} ${error.replace(/\n/g, "\n    ")}`);
    }
    console.log(""); // Spacing
  }
}
