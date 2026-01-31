import { cliLogger as logger } from "#veryfront/utils";
import { bold, cyan, red, yellow } from "#veryfront/compat/console";
import type { VeryfrontConfig } from "#veryfront/config/types.ts";

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
      `Missing API Key for provider "${bold(name)}".\n` +
        `The provider is configured but no API key was found.\n` +
        `Please add ${cyan(`${name.toUpperCase()}_API_KEY`)} to your .env file.`,
    );
  }

  return result;
}

function _printMessages(
  title: string,
  icon: string,
  color: (text: string) => string,
  messages: string[],
): void {
  if (messages.length === 0) return;

  console.log("");
  logger.warn(`${color(title)}:`);
  for (const message of messages) {
    console.log(`  ${color(icon)} ${message.replace(/\n/g, "\n    ")}`);
  }
  console.log("");
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
