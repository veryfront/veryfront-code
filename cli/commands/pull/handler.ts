/**
 * Pull command handler
 */

import { parsePullArgs, pullCommand } from "./command.ts";
import { showHeader } from "#cli/utils";
import type { ParsedArgs } from "#cli/shared/types";
import { parseArgsOrThrow } from "#cli/shared/args";

export async function handlePullCommand(args: ParsedArgs): Promise<void> {
  showHeader();
  await pullCommand(parseArgsOrThrow(parsePullArgs, "pull", args));
}
