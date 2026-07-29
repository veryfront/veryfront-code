/**
 * Deploy command handler
 */

import { deployCommand, parseDeployArgs } from "./command.ts";
import { showHeader } from "#cli/utils";
import type { ParsedArgs } from "#cli/shared/types";
import { parseArgsOrThrow } from "#cli/shared/args";

export async function handleDeployCommand(args: ParsedArgs): Promise<void> {
  showHeader();
  await deployCommand(parseArgsOrThrow(parseDeployArgs, "deploy", args));
}
