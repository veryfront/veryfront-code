/**
 * Up command handler
 */

import { parseUpArgs, upCommand } from "./command.ts";
import type { ParsedArgs } from "#cli/shared/types";
import { parseArgsOrThrow } from "#cli/shared/args";

export async function handleUpCommand(args: ParsedArgs): Promise<void> {
  await upCommand(parseArgsOrThrow(parseUpArgs, "up", args));
}
