/**
 * Dev command handler
 */

import { isAbsolute, join } from "#veryfront/platform/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { cliLogger, DEFAULT_DEV_SERVER_PORT } from "#veryfront/utils";
import { devCommand } from "./index.ts";
import { clearAllLocalCaches } from "../../../transforms/mdx/esm-module-loader/cache/index.ts";
import type { ParsedArgs } from "../../shared/types.ts";

async function resolveProjectDir(args: ParsedArgs): Promise<string> {
  const projectArg = args.project ? String(args.project) : undefined;

  if (projectArg) {
    const projectDir = isAbsolute(projectArg) ? projectArg : join(cwd(), projectArg);
    cliLogger.debug("Using project directory from --project flag", { projectDir });
    return projectDir;
  }

  const projectDir = cwd();
  const fs = createFileSystem();

  const configPaths = ["veryfront.config.ts", "veryfront.config.js"].map((file) =>
    join(projectDir, file)
  );

  for (const configPath of configPaths) {
    if (await fs.exists(configPath)) return projectDir;
  }

  cliLogger.debug("No veryfront config found, using defaults");
  return projectDir;
}

export async function handleDevCommand(args: ParsedArgs): Promise<void> {
  const projectDir = await resolveProjectDir(args);
  const port = typeof args.port === "number" ? args.port : DEFAULT_DEV_SERVER_PORT;

  // Clear stale ESM caches to prevent module resolution issues from previous runs
  await clearAllLocalCaches();

  await devCommand({
    port,
    projectDir,
    hmr: args.hmr !== false,
  });
}
