/**
 * Lock command handler
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import { lockCommand } from "./command.ts";
import { createArgParser } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";
import { handleProjectDirCommand } from "../../shared/handler-utils.ts";

const getLockArgsSchema = defineSchema((v) =>
  v.object({
    projectDir: v.string().default(""),
    update: v.boolean().default(false),
    verify: v.boolean().default(false),
    clear: v.boolean().default(false),
    list: v.boolean().default(false),
    force: v.boolean().default(false),
  })
);

const LockArgsSchema = lazySchema(getLockArgsSchema);

const parseLockArgs = createArgParser(LockArgsSchema, {
  projectDir: { keys: ["project"], type: "string" },
  update: { keys: ["update"], type: "boolean" },
  verify: { keys: ["verify"], type: "boolean" },
  clear: { keys: ["clear"], type: "boolean" },
  list: { keys: ["list"], type: "boolean" },
  force: { keys: ["force", "f", "y"], type: "boolean" },
});

export async function handleLockCommand(args: ParsedArgs): Promise<void> {
  await handleProjectDirCommand(args, parseLockArgs, "lock", lockCommand);
}
