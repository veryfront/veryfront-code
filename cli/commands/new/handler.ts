/**
 * New command handler
 */

import { newCommand, parseNewArgs } from "./command.ts";
import { promptProjectName } from "./menu.ts";
import { exitProcess } from "#cli/utils";
import type { ParsedArgs } from "#cli/shared/types";

export async function handleNewCommand(args: ParsedArgs): Promise<void> {
  let name = args._[1] as string;

  if (!name) {
    const prompted = await promptProjectName();
    if (!prompted) {
      exitProcess(0);
      return;
    }
    name = prompted;
  }

  const result = parseNewArgs(args);
  if (!result.success) {
    throw new Error(`Invalid new arguments: ${result.error.message}`);
  }

  await newCommand(name, result.data);
}
