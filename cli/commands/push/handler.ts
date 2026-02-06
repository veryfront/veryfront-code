/**
 * Push command handler
 */

import { parsePushArgs, pushCommand } from "./command.ts";
import { showLogo } from "#cli/utils";
import type { ParsedArgs } from "#cli/shared/types";

export async function handlePushCommand(args: ParsedArgs): Promise<void> {
  showLogo();
  const result = parsePushArgs(args);
  if (!result.success) {
    throw new Error(`Invalid push arguments: ${result.error.message}`);
  }
  await pushCommand(result.data);
}
