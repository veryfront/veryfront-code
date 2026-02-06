/**
 * Merge command handler
 */

import { mergeCommand, parseMergeArgs } from "./command.ts";
import { showLogo } from "#cli/utils";
import type { ParsedArgs } from "#cli/shared/types";

export async function handleMergeCommand(args: ParsedArgs): Promise<void> {
  showLogo();
  const result = parseMergeArgs(args);
  if (!result.success) {
    throw new Error(`Invalid merge arguments: ${result.error.message}`);
  }
  await mergeCommand(result.data);
}
