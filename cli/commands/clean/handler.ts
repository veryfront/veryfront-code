/**
 * Clean command handler
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import { cleanCommand } from "./command.ts";
import { CommonArgs, createArgParser } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";
import { handleProjectDirCommand } from "../../shared/handler-utils.ts";

const getCleanArgsSchema = defineSchema((v) =>
  v.object({
    projectDir: v.string().default(""),
    cache: v.boolean().default(false),
    build: v.boolean().default(false),
    all: v.boolean().default(false),
    force: v.boolean().default(false),
  })
);

const CleanArgsSchema = lazySchema(getCleanArgsSchema);

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
