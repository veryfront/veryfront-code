/**
 * Deploy command handler
 */

import { deployCommand, parseDeployArgs } from "./command.ts";
import { showLogo } from "#cli/utils";
import type { ParsedArgs } from "#cli/shared/types";

export async function handleDeployCommand(args: ParsedArgs): Promise<void> {
  showLogo();
  const result = parseDeployArgs(args);
  if (!result.success) {
    throw new Error(`Invalid deploy arguments: ${result.error.message}`);
  }
  await deployCommand(result.data);
}
