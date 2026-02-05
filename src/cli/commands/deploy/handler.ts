/**
 * Deploy command handler
 */

import { deployCommand, parseDeployArgs } from "./command.ts";
import type { ParsedArgs } from "../../index/types.ts";

export async function handleDeployCommand(args: ParsedArgs): Promise<void> {
  const result = parseDeployArgs(args);
  if (!result.success) {
    throw new Error(`Invalid deploy arguments: ${result.error.message}`);
  }
  await deployCommand(result.data);
}
