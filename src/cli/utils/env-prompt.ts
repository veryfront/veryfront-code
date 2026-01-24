/****
 * Environment variable prompting utilities for CLI scaffolding
 * @module
 */

import { cliLogger as logger } from "#veryfront/utils";
import { cyan, dim, green, yellow } from "#veryfront/compat/console";
import { isInteractive as checkIsInteractive } from "#veryfront/platform/compat/process.ts";
import { isCiEnv, isDenoTestingEnv } from "#veryfront/config/env.ts";
import type { EnvVarConfig } from "../templates/index.ts";
import { promptUser } from "./index.ts";

export interface EnvPromptOptions {
  /** Whether to run in interactive mode (prompt for values) */
  interactive?: boolean;
  /** Whether to skip prompting entirely */
  skipPrompt?: boolean;
  /** Pre-filled environment variable values (from config file) */
  prefilledValues?: Record<string, string>;
}

export interface EnvPromptResult {
  /** Content for .env file */
  envContent: string;
  /** Content for .env.example file */
  envExampleContent: string;
  /** Map of env var names to their values */
  values: Record<string, string>;
}

function maskSensitiveValue(value: string): string {
  if (value.length > 8) {
    return `${value.substring(0, 4)}...${value.substring(value.length - 4)}`;
  }
  return "****";
}

/**
 * Prompts the user for environment variable values during scaffolding
 *
 * @param envVars - Array of environment variable configurations
 * @param options - Prompting options
 * @returns Object containing .env content, .env.example content, and values map
 */
export async function promptForEnvVars(
  envVars: EnvVarConfig[],
  options: EnvPromptOptions = {},
): Promise<EnvPromptResult> {
  const values: Record<string, string> = {};
  const envLines: string[] = [];
  const exampleLines: string[] = [
    "# Environment variables for this project",
    "# Copy this file to .env and fill in your values",
    "",
  ];

  const disablePrompt = options.skipPrompt || isCiEnv() || isDenoTestingEnv();
  const interactive = options.interactive ?? (!disablePrompt && checkIsInteractive());

  const prefilledValues = options.prefilledValues ?? {};
  const hasPrefilledValues = Object.keys(prefilledValues).length > 0;

  if (envVars.length > 0) {
    if (interactive) {
      logger.info("");
      logger.info(`${cyan("Environment Setup:")}`);
      logger.info(dim("  Press Enter to skip and set values later\n"));
    } else if (hasPrefilledValues) {
      logger.info("");
      logger.info(`${cyan("Environment Setup:")} Using values from config file`);
    }
  }

  for (const envVar of envVars) {
    const commentLines: string[] = [`# ${envVar.description}`];

    if (envVar.docsUrl) commentLines.push(`# Get yours at: ${envVar.docsUrl}`);
    if (envVar.required) commentLines.push("# Required");

    const placeholder = envVar.placeholder ?? "your_value_here";
    exampleLines.push(...commentLines, `${envVar.name}=${placeholder}`, "");

    let value = prefilledValues[envVar.name] ?? "";

    if (!value && interactive) {
      value = await promptForSingleEnvVar(envVar);
    } else if (value && hasPrefilledValues) {
      const displayValue = envVar.sensitive ? maskSensitiveValue(value) : value;
      logger.debug(`  ${cyan(envVar.name)}: ${dim(displayValue)}`);
    }

    if (!value && envVar.default) value = envVar.default;

    values[envVar.name] = value;

    if (value) {
      envLines.push(`${envVar.name}=${value}`);
    } else if (envVar.required) {
      envLines.push(`# ${envVar.name}= # Required - see .env.example`);
    }
  }

  if (interactive && envVars.length > 0) {
    const filledCount = Object.values(values).filter(Boolean).length;

    if (filledCount === envVars.length) {
      logger.info(`\n${green("All environment variables configured!")}`);
    } else if (filledCount > 0) {
      logger.info(
        `\n${yellow("Some environment variables skipped.")} Edit ${
          cyan(".env")
        } to add them later.`,
      );
    } else {
      logger.info(
        `\n${yellow("Environment variables skipped.")} Edit ${cyan(".env")} to configure them.`,
      );
    }
  }

  return {
    envContent: `${envLines.join("\n")}\n`,
    envExampleContent: exampleLines.join("\n"),
    values,
  };
}

/**
 * Prompts for a single environment variable value
 */
async function promptForSingleEnvVar(envVar: EnvVarConfig): Promise<string> {
  const requiredIndicator = envVar.required ? yellow("*") : "";
  const docsHint = envVar.docsUrl ? dim(` (${envVar.docsUrl})`) : "";

  try {
    const value = await promptUser(
      `  ${
        cyan(envVar.name)
      }${requiredIndicator}: ${envVar.description}${docsHint}\n  Enter value (press Enter to skip): `,
    );

    const trimmedValue = value.trim();

    if (trimmedValue) {
      const displayValue = envVar.sensitive ? maskSensitiveValue(trimmedValue) : trimmedValue;
      logger.info(dim(`    Set to: ${displayValue}`));
    } else {
      logger.info(dim("    Skipped (will use placeholder)"));
    }

    return trimmedValue;
  } catch (error) {
    logger.debug("Failed to read stdin:", error);
    logger.info(dim("    Skipped (will use placeholder)"));
    return "";
  }
}

/**
 * Generates content for .gitignore to ensure .env is not committed
 */
export function generateGitignoreContent(existingContent?: string): string {
  const requiredEntries = [
    "# Environment files",
    ".env",
    ".env.local",
    ".env.*.local",
    "",
  ];

  if (!existingContent) {
    return [
      "# Dependencies",
      "node_modules/",
      "",
      ...requiredEntries,
      "# Build output",
      "dist/",
      ".veryfront/",
      "",
      "# IDE",
      ".vscode/",
      ".idea/",
      "",
    ].join("\n");
  }

  if (existingContent.includes(".env")) return existingContent;

  return `${existingContent.trimEnd()}\n\n${requiredEntries.join("\n")}`;
}
