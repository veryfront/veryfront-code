/**
 * Dev command handler for CLI
 *
 * @module cli/index/dev-handler
 */

import { join } from "std/path/mod.ts";
import { cliLogger, DEFAULT_DEV_SERVER_PORT } from "@veryfront/utils";
import { devCommand } from "../commands/dev.ts";
import { showLogo } from "../utils/index.ts";
import type { ParsedArgs } from "./types.ts";
import { cwd } from "../../platform/compat/process.ts";
import { createFileSystem } from "../../platform/compat/fs.ts";

/**
 * Detect the project directory by checking for config files
 *
 * @returns Project directory path
 */
async function detectProjectDir(): Promise<string> {
  const projectDir = cwd();
  const configPath = join(projectDir, "veryfront.config.ts");
  const altConfigPath = join(projectDir, "veryfront.config.js");

  const fs = createFileSystem();
  if (await fs.exists(configPath)) {
    return projectDir;
  }
  if (await fs.exists(altConfigPath)) {
    return projectDir;
  }
  // No config file found, but that's okay - we'll use defaults
  cliLogger.debug("No veryfront config found, using defaults");
  return projectDir;
}

/**
 * Handle the dev command execution
 *
 * @param args - Parsed CLI arguments
 */
export async function handleDevCommand(args: ParsedArgs): Promise<void> {
  showLogo();

  const projectDir = await detectProjectDir();

  const port = typeof args.port === "number" ? args.port : DEFAULT_DEV_SERVER_PORT;
  await devCommand({
    port,
    projectDir,
    hmr: args.hmr !== false,
  });
}
