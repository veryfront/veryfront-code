
import { join } from "std/path/mod.ts";
import { cliLogger, DEFAULT_DEV_SERVER_PORT } from "@veryfront/utils";
import { devCommand } from "../commands/dev.ts";
import { showLogo } from "../utils/index.ts";
import type { ParsedArgs } from "./types.ts";
import { cwd } from "../../platform/compat/process.ts";
import { createFileSystem } from "../../platform/compat/fs.ts";

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
  cliLogger.debug("No veryfront config found, using defaults");
  return projectDir;
}

export async function handleDevCommand(args: ParsedArgs): Promise<void> {
  showLogo();

  // Use --dir argument if provided, otherwise detect from cwd
  const projectDir = args.dir ? String(args.dir) : await detectProjectDir();

  const port = typeof args.port === "number" ? args.port : DEFAULT_DEV_SERVER_PORT;
  await devCommand({
    port,
    projectDir,
    hmr: args.hmr !== false,
  });
}
