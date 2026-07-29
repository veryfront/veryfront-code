/**
 * Push command handler
 */

import { parsePushArgs, pushCommand } from "./command.ts";
import { showHeader } from "#cli/utils";
import type { ParsedArgs } from "#cli/shared/types";
import { parseArgsOrThrow } from "#cli/shared/args";

export async function handlePushCommand(args: ParsedArgs): Promise<void> {
  showHeader();
  await pushCommand(parseArgsOrThrow(parsePushArgs, "push", args));
}
