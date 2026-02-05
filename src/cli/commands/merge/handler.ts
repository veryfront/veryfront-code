/**
 * Merge command handler
 */

import { mergeCommand, parseMergeArgs } from "./command.ts";
import type { ParsedArgs } from "../../index/types.ts";

export async function handleMergeCommand(args: ParsedArgs): Promise<void> {
  const result = parseMergeArgs(args);
  if (!result.success) {
    throw new Error(`Invalid merge arguments: ${result.error.message}`);
  }
  await mergeCommand(result.data);
}
