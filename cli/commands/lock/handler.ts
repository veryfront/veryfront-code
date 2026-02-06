/**
 * Lock command handler
 */

import { z } from "zod";
import { lockCommand } from "./command.ts";
import { createArgParser } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";
import { handleProjectDirCommand } from "../../shared/handler-utils.ts";

const LockArgsSchema = z.object({
  projectDir: z.string().default(""),
  update: z.boolean().default(false),
  verify: z.boolean().default(false),
  clear: z.boolean().default(false),
  list: z.boolean().default(false),
  force: z.boolean().default(false),
});

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
