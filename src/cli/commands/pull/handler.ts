/**
 * Pull command handler
 */

import { parsePullArgs, pullCommand } from "./command.ts";
import type { ParsedArgs } from "../../index/types.ts";

export async function handlePullCommand(args: ParsedArgs): Promise<void> {
  const result = parsePullArgs(args);
  if (!result.success) {
    throw new Error(`Invalid pull arguments: ${result.error.message}`);
  }
  await pullCommand(result.data);
}
