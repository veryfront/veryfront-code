
import { cliLogger as logger } from "@veryfront/utils";
import { cyan, dim, green, yellow } from "@veryfront/compat/console";
import { getEnv, isInteractive as checkIsInteractive } from "../../platform/compat/process.ts";
import type { EnvVarConfig } from "../templates/index.ts";
import { promptUser } from "./index.ts";

export interface EnvPromptOptions {
  interactive?: boolean;
  skipPrompt?: boolean;
  prefilledValues?: Record<string, string>;
}

export interface EnvPromptResult {
  envContent: string;
  envExampleContent: string;
  values: Record<string, string>;
}

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

  const disablePrompt = options.skipPrompt ||
    getEnv("CI") === "1" ||
    getEnv("DENO_TESTING") === "1";
  const interactive = options.interactive ?? (!disablePrompt && checkIsInteractive());

  if (interactive && envVars.length > 0) {
    logger.info("");
    logger.info(`${cyan("Environment Setup:")}`);
    logger.info(dim("  Press Enter to skip and set values later\n"));
  }

  const prefilledValues = options.prefilledValues || {};
  const hasPrefilledValues = Object.keys(prefilledValues).length > 0;

  if (hasPrefilledValues && envVars.length > 0) {
    logger.info("");
    logger.info(`${cyan("Environment Setup:")} Using values from config file`);
  }

  for (const envVar of envVars) {
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

    let value = prefilledValues[envVar.name] || "";

    if (!value && interactive) {
      value = await promptForSingleEnvVar(envVar);
    } else if (value && hasPrefilledValues) {
      if (envVar.sensitive) {
        const masked = value.length > 8
          ? value.substring(0, 4) + "..." + value.substring(value.length - 4)
          : "****";
        logger.debug(`  ${cyan(envVar.name)}: ${dim(masked)}`);
      } else {
        logger.debug(`  ${cyan(envVar.name)}: ${dim(value)}`);
      }
    }

    if (!value && envVar.default) {
      value = envVar.default;
    }

    values[envVar.name] = value;

    if (value) {
      envLines.push(`${envVar.name}=${value}`);
    } else if (envVar.required) {
      envLines.push(`# ${envVar.name}= # Required - see .env.example`);
    }
  }

  if (interactive && envVars.length > 0) {
    const filledCount = Object.values(values).filter((v) => v).length;
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
    envContent: envLines.join("\n") + "\n",
    envExampleContent: exampleLines.join("\n"),
    values,
  };
}

async function promptForSingleEnvVar(envVar: EnvVarConfig): Promise<string> {
  const requiredIndicator = envVar.required ? `${yellow("*")}` : "";
  const docsHint = envVar.docsUrl ? dim(` (${envVar.docsUrl})`) : "";

  try {
    const value = await promptUser(
      `  ${
        cyan(envVar.name)
      }${requiredIndicator}: ${envVar.description}${docsHint}\n  Enter value (press Enter to skip): `,
    );

    const trimmedValue = value.trim();

    if (trimmedValue && envVar.sensitive) {
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
    logger.debug("Failed to read stdin:", error);
    logger.info(dim("    Skipped (will use placeholder)"));
    return "";
  }
}

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

  if (existingContent.includes(".env")) {
    return existingContent;
  }

  return existingContent.trimEnd() + "\n\n" + requiredEntries.join("\n");
}
