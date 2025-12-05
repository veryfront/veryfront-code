/**
 * Environment variable prompting utilities for CLI scaffolding
 * @module
 */

import { cliLogger as logger } from "@veryfront/utils";
import { cyan, dim, green, yellow } from "@veryfront/compat/console";
import { getEnv, isInteractive as checkIsInteractive } from "../../platform/compat/process.ts";
import type { EnvVarConfig } from "../templates/index.ts";
import { promptUser } from "./index.ts";

export interface EnvPromptOptions {
  /** Whether to run in interactive mode (prompt for values) */
  interactive?: boolean;
  /** Whether to skip prompting entirely */
  skipPrompt?: boolean;
}

export interface EnvPromptResult {
  /** Content for .env file */
  envContent: string;
  /** Content for .env.example file */
  envExampleContent: string;
  /** Map of env var names to their values */
  values: Record<string, string>;
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

  // Determine if we should prompt interactively
  const disablePrompt = options.skipPrompt ||
    getEnv("CI") === "1" ||
    getEnv("DENO_TESTING") === "1";
  const interactive = options.interactive ?? (!disablePrompt && checkIsInteractive());

  if (interactive && envVars.length > 0) {
    logger.info("");
    logger.info(`${cyan("Environment Setup:")}`);
    logger.info(dim("  Press Enter to skip and set values later\n"));
  }

  for (const envVar of envVars) {
    // Build the .env.example entry
    const commentLines: string[] = [];
    commentLines.push(`# ${envVar.description}`);
    if (envVar.docsUrl) {
      commentLines.push(`# Get yours at: ${envVar.docsUrl}`);
    }
    if (envVar.required) {
      commentLines.push("# Required");
    }

    const placeholder = envVar.placeholder || "your_value_here";
    exampleLines.push(...commentLines);
    exampleLines.push(`${envVar.name}=${placeholder}`);
    exampleLines.push("");

    // Prompt for value if interactive
    let value = "";
    if (interactive) {
      value = await promptForSingleEnvVar(envVar);
    }

    values[envVar.name] = value;

    // Add to .env content (use placeholder if no value provided)
    if (value) {
      envLines.push(`${envVar.name}=${value}`);
    } else {
      // Still add the line with placeholder so user knows it needs to be set
      envLines.push(`${envVar.name}=${placeholder}`);
    }
  }

  if (interactive && envVars.length > 0) {
    const filledCount = Object.values(values).filter((v) => v).length;
    if (filledCount === envVars.length) {
      logger.info(`\n${green("All environment variables configured!")}`);
    } else if (filledCount > 0) {
      logger.info(
        `\n${yellow("Some environment variables skipped.")} Edit ${cyan(".env")} to add them later.`,
      );
    } else {
      logger.info(
        `\n${yellow("Environment variables skipped.")} Edit ${cyan(".env")} to configure them.`,
      );
    }
  }

  return {
    envContent: envLines.join("\n") + "\n",
    envExampleContent: exampleLines.join("\n"),
    values,
  };
}

/**
 * Prompts for a single environment variable value
 */
async function promptForSingleEnvVar(envVar: EnvVarConfig): Promise<string> {
  const requiredIndicator = envVar.required ? `${yellow("*")}` : "";
  const docsHint = envVar.docsUrl ? dim(` (${envVar.docsUrl})`) : "";

  try {
    // Use cross-platform promptUser which handles both Deno and Node.js
    const value = await promptUser(
      `  ${cyan(envVar.name)}${requiredIndicator}: ${envVar.description}${docsHint}\n  Enter value (press Enter to skip): `,
    );

    const trimmedValue = value.trim();

    if (trimmedValue && envVar.sensitive) {
      // Mask the displayed value for sensitive inputs
      const masked = trimmedValue.length > 8
        ? trimmedValue.substring(0, 4) + "..." + trimmedValue.substring(trimmedValue.length - 4)
        : "****";
      logger.info(dim(`    Set to: ${masked}`));
    } else if (trimmedValue) {
      logger.info(dim(`    Set to: ${trimmedValue}`));
    } else {
      logger.info(dim("    Skipped (will use placeholder)"));
    }

    return trimmedValue;
  } catch (error) {
    // Prompt may fail in non-interactive environments
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

  // Check if .env is already in gitignore
  if (existingContent.includes(".env")) {
    return existingContent;
  }

  // Append env entries to existing content
  return existingContent.trimEnd() + "\n\n" + requiredEntries.join("\n");
}
