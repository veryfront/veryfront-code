/**
 * Merge command handler
 */

import { mergeCommand, parseMergeArgs } from "./command.ts";
import { showLogo } from "../../utils/index.ts";
import type { ParsedArgs } from "../../shared/types.ts";

export async function handleMergeCommand(args: ParsedArgs): Promise<void> {
  showLogo();
  const result = parseMergeArgs(args);
  if (!result.success) {
    throw new Error(`Invalid merge arguments: ${result.error.message}`);
  }
  await mergeCommand(result.data);
}
