import { cliLogger as logger } from "@veryfront/utils";
import { bold, cyan, red, yellow } from "@veryfront/compat/console";
import type { VeryfrontConfig } from "../../core/config/types.ts";

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
}

export function validateAIConfig(config: VeryfrontConfig): ValidationResult {
  const result: ValidationResult = {
    valid: true,
    warnings: [],
    errors: [],
  };

  if (!config.ai || !config.ai.providers) {
    return result;
  }

  const providers = config.ai.providers;

  for (const [name, providerConfig] of Object.entries(providers)) {
    if (!providerConfig.apiKey) {
      result.warnings.push(
        `Missing API Key for provider "${bold(name)}".\n` +
          `The provider is configured but no API key was found.\n` +
          `Please add ${cyan(`${name.toUpperCase()}_API_KEY`)} to your .env file.`,
      );
    }
  }

  return result;
}

export function runAIConfigValidation(config: VeryfrontConfig): void {
  const result = validateAIConfig(config);

  if (result.warnings.length > 0) {
    console.log("");
    logger.warn(`${yellow("AI Configuration Warning")}:`);
    for (const warning of result.warnings) {
      console.log(`  ${yellow("!")} ${warning.replace(/\n/g, "\n    ")}`);
    }
    console.log("");
  }

  if (result.errors.length > 0) {
    console.log("");
    logger.error(`${red("AI Configuration Error")}:`);
    for (const error of result.errors) {
      console.log(`  ${red("x")} ${error.replace(/\n/g, "\n    ")}`);
    }
    console.log("");
  }
}
