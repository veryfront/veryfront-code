/**
 * Dev command handler for CLI
 *
 * @module cli/index/dev-handler
 */

import { isAbsolute, join } from "@veryfront/platform/compat/path/index.ts";
import { cliLogger, DEFAULT_DEV_SERVER_PORT } from "@veryfront/utils";
import { devCommand } from "../commands/dev.ts";
import { showLogo } from "../utils/index.ts";
import type { ParsedArgs } from "./types.ts";
import { cwd } from "@veryfront/platform/compat/process.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";

/**
 * Resolve project directory from CLI args or detect from config files
 *
 * @param args - Parsed CLI arguments
 * @returns Project directory path
 */
async function resolveProjectDir(args: ParsedArgs): Promise<string> {
  // Check for --project flag (can be relative or absolute path)
  const projectArg = args.project ? String(args.project) : undefined;
  if (projectArg) {
    const resolved = isAbsolute(projectArg) ? projectArg : join(cwd(), projectArg);
    cliLogger.debug("Using project directory from --project flag", { projectDir: resolved });
    return resolved;
  }

  // Fall back to detecting config in current directory
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

  const projectDir = await resolveProjectDir(args);

  const port = typeof args.port === "number" ? args.port : DEFAULT_DEV_SERVER_PORT;
  await devCommand({
    port,
    projectDir,
    hmr: args.hmr !== false,
  });
}
