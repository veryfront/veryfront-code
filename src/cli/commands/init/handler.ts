/**
 * Init Command Handler
 *
 * Handles argument parsing and config file loading for the init command.
 */

import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { cliLogger } from "#veryfront/utils";
import { exitProcess } from "../../utils/index.ts";
import { resolvePath } from "../../shared/path-utils.ts";
import { initCommand } from "./init-command.ts";
import type { ParsedArgs } from "../../shared/types.ts";
import type { InitTemplate } from "./types.ts";
import type { IntegrationName } from "../../templates/types.ts";

/**
 * Handle the init command with argument parsing and config file support
 */
export async function handleInitCommand(args: ParsedArgs): Promise<void> {
  let name = args._[1] as string | undefined;
  let template = (args.t || args.template) as InitTemplate | undefined;
  let integrations: IntegrationName[] | undefined;
  let skipInstall = Boolean(args["skip-install"]);
  let skipEnvPrompt = Boolean(args["skip-env-prompt"]);
  let env: Record<string, string> | undefined;

  // Load config file if provided
  const configPath = args.config || args.c;
  if (configPath) {
    const fs = createFileSystem();
    const resolvedPath = resolvePath(String(configPath));

    try {
      const configContent = await fs.readTextFile(resolvedPath);
      const config = JSON.parse(configContent) as {
        name?: string;
        template?: InitTemplate;
        integrations?: IntegrationName[];
        skipInstall?: boolean;
        skipEnvPrompt?: boolean;
        env?: Record<string, string>;
      };

      // Config values serve as defaults, CLI args take precedence
      name ||= config.name;
      template ||= config.template;
      integrations ||= config.integrations;
      skipInstall ||= config.skipInstall ?? false;
      skipEnvPrompt ||= config.skipEnvPrompt ?? false;
      env = config.env;

      cliLogger.debug(`Loaded config from ${resolvedPath}`);
    } catch (error) {
      cliLogger.error(`Failed to read config file: ${resolvedPath}`);
      if (error instanceof SyntaxError) {
        cliLogger.error("Invalid JSON syntax in config file");
      }
      exitProcess(1);
      return;
    }
  }

  // Parse integrations from CLI args
  if (args.integrations) {
    integrations = String(args.integrations)
      .split(",")
      .map((s) => s.trim()) as IntegrationName[];
  }

  await initCommand({
    name,
    template,
    skipInstall,
    skipEnvPrompt,
    integrations,
    env,
  });
}
