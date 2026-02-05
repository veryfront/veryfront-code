/**
 * Push command handler
 */

import { parsePushArgs, pushCommand } from "./command.ts";
import type { ParsedArgs } from "../../index/types.ts";

export async function handlePushCommand(args: ParsedArgs): Promise<void> {
  const result = parsePushArgs(args);
  if (!result.success) {
    throw new Error(`Invalid push arguments: ${result.error.message}`);
  }
  await pushCommand(result.data);
}
