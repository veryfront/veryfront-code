/**
 * Lock command handler
 */

import { cwd } from "#veryfront/platform/compat/process.ts";
import { lockCommand } from "./command.ts";
import type { ParsedArgs } from "../../index/types.ts";

export async function handleLockCommand(args: ParsedArgs): Promise<void> {
  const projectDir = typeof args.project === "string" ? args.project : cwd();

  await lockCommand({
    projectDir,
    update: args.update === true,
    verify: args.verify === true,
    clear: args.clear === true,
    list: args.list === true,
    force: args.force === true || args.f === true || args.y === true,
  });
}
