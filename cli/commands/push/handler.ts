/**
 * Push command handler
 */

import { parsePushArgs, pushCommand } from "./command.ts";
import { showLogo } from "../../utils/index.ts";
import type { ParsedArgs } from "../../shared/types.ts";

export async function handlePushCommand(args: ParsedArgs): Promise<void> {
  showLogo();
  const result = parsePushArgs(args);
  if (!result.success) {
    throw new Error(`Invalid push arguments: ${result.error.message}`);
  }
  await pushCommand(result.data);
}
