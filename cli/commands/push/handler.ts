/**
 * Push command handler
 */

import { parsePushArgs, pushCommand } from "./command.ts";
import { showLogo } from "#cli/utils";
import type { ParsedArgs } from "#cli/shared/types";
import { parseArgsOrThrow } from "#cli/shared/args";

export async function handlePushCommand(args: ParsedArgs): Promise<void> {
  showLogo();
  await pushCommand(parseArgsOrThrow(parsePushArgs, "push", args));
}
