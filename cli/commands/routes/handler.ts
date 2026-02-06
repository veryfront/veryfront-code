/**
 * Routes command handler
 */

import { z } from "zod";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { routesCommand } from "./command.ts";
import { showLogo } from "#cli/utils";
import { CommonArgs, createArgParser } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

const RoutesArgsSchema = z.object({
  projectDir: z.string().default(""),
  json: z.boolean().default(false),
});

export const parseRoutesArgs = createArgParser(RoutesArgsSchema, {
  projectDir: CommonArgs.projectDir,
  json: { keys: ["json"], type: "boolean" },
});

export async function handleRoutesCommand(args: ParsedArgs): Promise<void> {
  showLogo();
  const result = parseRoutesArgs(args);
  if (!result.success) {
    throw new Error(`Invalid routes arguments: ${result.error.message}`);
  }
  const projectDir = result.data.projectDir || cwd();
  await routesCommand(projectDir, { json: result.data.json });
}
