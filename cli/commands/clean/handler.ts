/**
 * Clean command handler
 */

import { z } from "zod";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { cleanCommand } from "./command.ts";
import { showLogo } from "../../utils/index.ts";
import { CommonArgs, createArgParser } from "../../shared/args.ts";
import type { ParsedArgs } from "../../shared/types.ts";

const CleanArgsSchema = z.object({
  projectDir: z.string().default(""),
  cache: z.boolean().default(false),
  build: z.boolean().default(false),
  all: z.boolean().default(false),
  force: z.boolean().default(false),
});

const parseCleanArgs = createArgParser(CleanArgsSchema, {
  projectDir: CommonArgs.projectDir,
  cache: { keys: ["cache"], type: "boolean" },
  build: { keys: ["build"], type: "boolean" },
  all: { keys: ["all"], type: "boolean" },
  force: { keys: ["force", "f", "y"], type: "boolean" },
});

export async function handleCleanCommand(args: ParsedArgs): Promise<void> {
  showLogo();
  const result = parseCleanArgs(args);
  if (!result.success) {
    throw new Error(`Invalid clean arguments: ${result.error.message}`);
  }
  await cleanCommand({
    ...result.data,
    projectDir: result.data.projectDir || cwd(),
  });
}
