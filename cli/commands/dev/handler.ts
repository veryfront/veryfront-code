/**
 * Dev command handler
 */

import { z } from "zod";
import { isAbsolute, join } from "#veryfront/platform/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { cliLogger, DEFAULT_DEV_SERVER_PORT } from "#veryfront/utils";
import { devCommand } from "./index.ts";
import { clearAllLocalCaches } from "#veryfront/transforms/mdx/esm-module-loader/cache/index.ts";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

const DevArgsSchema = z.object({
  port: z.number().default(DEFAULT_DEV_SERVER_PORT),
  project: z.string().optional(),
  hmr: z.boolean().default(true),
});

export const parseDevArgs = createArgParser(DevArgsSchema, {
  port: { keys: ["port", "p"], type: "number" },
  project: { keys: ["project"], type: "string" },
  hmr: { keys: ["hmr"], type: "boolean" },
});

async function resolveProjectDir(projectArg: string | undefined): Promise<string> {
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
  const opts = parseArgsOrThrow(parseDevArgs, "dev", args);
  const projectDir = await resolveProjectDir(opts.project);

  // Clear stale ESM caches to prevent module resolution issues from previous runs
  await clearAllLocalCaches();

  await devCommand({
    port: opts.port,
    projectDir,
    hmr: opts.hmr,
  });
}
