/**
 * Pull command handler
 */

import { parsePullArgs, pullCommand } from "./command.ts";
import { showLogo } from "../../utils/index.ts";
import type { ParsedArgs } from "../../shared/types.ts";

export async function handlePullCommand(args: ParsedArgs): Promise<void> {
  showLogo();
  const result = parsePullArgs(args);
  if (!result.success) {
    throw new Error(`Invalid pull arguments: ${result.error.message}`);
  }
  await pullCommand(result.data);
}
