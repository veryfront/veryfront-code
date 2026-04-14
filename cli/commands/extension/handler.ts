/**
 * Extension command handler — routes to subcommands.
 *
 * @module cli/commands/extension/handler
 */

import type { ParsedArgs } from "#cli/shared/types";
import { runExtensionInit } from "./init-command.ts";
import { runExtensionValidate } from "./validate-command.ts";

export async function handleExtensionCommand(args: ParsedArgs): Promise<void> {
  const subcommand = args._[1] as string | undefined;

  switch (subcommand) {
    case "init": {
      const name = args._[2] as string;
      if (!name) {
        console.error("Usage: veryfront extension init <name>");
        Deno.exit(1);
      }
      await runExtensionInit(name, Deno.cwd());
      console.log(`Extension scaffolded at extensions/${name}/`);
      break;
    }
    case "validate": {
      const path = (args._[2] as string) || ".";
      await runExtensionValidate(path);
      break;
    }
    default:
      console.error("Usage: veryfront extension <init|validate> [args]");
      Deno.exit(1);
  }
}
