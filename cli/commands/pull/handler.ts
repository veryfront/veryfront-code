/**
 * Pull command handler
 */

import { parsePullArgs, pullCommand } from "./command.ts";
import { showLogo } from "#cli/utils";
import type { ParsedArgs } from "#cli/shared/types";
import { parseArgsOrThrow } from "#cli/shared/args";

export async function handlePullCommand(args: ParsedArgs): Promise<void> {
  showLogo();
  await pullCommand(parseArgsOrThrow(parsePullArgs, "pull", args));
}
