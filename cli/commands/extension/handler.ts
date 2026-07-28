/**
 * Extension command handler — routes to subcommands.
 *
 * @module cli/commands/extension/handler
 */

import type { ParsedArgs } from "#cli/shared/types";
import { exitProcess, logSuccess, logUsageError } from "#cli/utils";
import { runExtensionInit, validateExtensionName } from "./init-command.ts";
import { runExtensionValidate } from "./validate-command.ts";

export async function handleExtensionCommand(args: ParsedArgs): Promise<void> {
  const subcommand = args._[1] as string | undefined;

  switch (subcommand) {
    case "init": {
      const name = args._[2] as string;
      if (!name) {
        logUsageError("Usage: veryfront extension init <name>");
        exitProcess(2);
        return;
      }
      const nameError = validateExtensionName(name);
      if (nameError) {
        logUsageError(nameError);
        exitProcess(2);
        return;
      }
      await runExtensionInit(name, Deno.cwd());
      logSuccess(`Extension scaffolded at extensions/${name}/`);
      break;
    }
    case "validate": {
      const path = (args._[2] as string) || ".";
      await runExtensionValidate(path);
      break;
    }
    default:
      logUsageError("Usage: veryfront extension <init|validate> [args]");
      exitProcess(2);
  }
}
