/**
 * Clean command handler
 */

import { z } from "zod";
import { cleanCommand } from "./command.ts";
import { CommonArgs, createArgParser } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";
import { handleProjectDirCommand } from "../../shared/handler-utils.ts";

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
  await handleProjectDirCommand(args, parseCleanArgs, "clean", cleanCommand);
}
