/**
 * Deploy command handler
 */

import { deployCommand, parseDeployArgs } from "./command.ts";
import { showLogo } from "#cli/utils";
import type { ParsedArgs } from "#cli/shared/types";
import { parseArgsOrThrow } from "#cli/shared/args";

export async function handleDeployCommand(args: ParsedArgs): Promise<void> {
  showLogo();
  await deployCommand(parseArgsOrThrow(parseDeployArgs, "deploy", args));
}
