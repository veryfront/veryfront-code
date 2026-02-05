/**
 * Up command handler
 */

import { parseUpArgs, upCommand } from "./command.ts";
import type { ParsedArgs } from "../../index/types.ts";

export async function handleUpCommand(args: ParsedArgs): Promise<void> {
  const result = parseUpArgs(args);
  if (!result.success) {
    throw new Error(`Invalid up arguments: ${result.error.message}`);
  }
  await upCommand(result.data);
}
