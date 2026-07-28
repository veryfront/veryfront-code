/**
 * Merge command handler
 */

import { mergeCommand, parseMergeArgs } from "./command.ts";
import { showHeader } from "#cli/utils";
import type { ParsedArgs } from "#cli/shared/types";
import { parseArgsOrThrow } from "#cli/shared/args";

export async function handleMergeCommand(args: ParsedArgs): Promise<void> {
  showHeader();
  await mergeCommand(parseArgsOrThrow(parseMergeArgs, "merge", args));
}
