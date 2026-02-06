/**
 * Merge command handler
 */

import { mergeCommand, parseMergeArgs } from "./command.ts";
import { showLogo } from "#cli/utils";
import type { ParsedArgs } from "#cli/shared/types";
import { parseArgsOrThrow } from "#cli/shared/args";

export async function handleMergeCommand(args: ParsedArgs): Promise<void> {
  showLogo();
  await mergeCommand(parseArgsOrThrow(parseMergeArgs, "merge", args));
}
