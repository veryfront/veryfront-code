/**
 * Dev command handler
 */

import { z } from "zod";
import { isAbsolute, join } from "#veryfront/platform/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { cliLogger, DEFAULT_DEV_SERVER_PORT } from "#veryfront/utils";
import { devCommand } from "./index.ts";
import { clearAllLocalCaches } from "../../../transforms/mdx/esm-module-loader/cache/index.ts";
import { createArgParser } from "../../shared/args.ts";
import type { ParsedArgs } from "../../shared/types.ts";

const DevArgsSchema = z.object({
  project: z.string().optional(),
  port: z.number().default(DEFAULT_DEV_SERVER_PORT),
  hmr: z.boolean().default(true),
});

const parseDevArgs = createArgParser(DevArgsSchema, {
  project: { keys: ["project"], type: "string" },
  port: { keys: ["port", "p"], type: "number" },
  hmr: { keys: ["hmr"], type: "boolean" },
});

function resolveProjectDir(projectArg?: string): string {
  if (projectArg) {
    const projectDir = isAbsolute(projectArg) ? projectArg : join(cwd(), projectArg);
    cliLogger.debug("Using project directory from --project flag", { projectDir });
    return projectDir;
  }
  return cwd();
}

export async function handleDevCommand(args: ParsedArgs): Promise<void> {
  const result = parseDevArgs(args);
  if (!result.success) {
    throw new Error(`Invalid dev arguments: ${result.error.message}`);
  }

  const { project, port, hmr } = result.data;
  const projectDir = resolveProjectDir(project);

  // Clear stale ESM caches to prevent module resolution issues from previous runs
  await clearAllLocalCaches();

  await devCommand({ port, projectDir, hmr });
}
