/**
 * Generate command handler for CLI
 *
 * @module cli/index/generate-handler
 */

import { generateCommand } from "../commands/generate.ts";
import { showCommandHelp } from "../help/index.ts";
import { exitProcess } from "../utils/index.ts";
import type { GenerateCommandArgs } from "./types.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";

/**
 * Handle the generate command execution
 *
 * @param args - Generate command arguments
 */
export async function handleGenerateCommand(args: GenerateCommandArgs): Promise<void> {
  const type = args._[1] as string;
  const name = args._[2] as string;
  const validTypes = ["page", "layout", "provider", "api", "integration"];

  // Integration type doesn't require a name (prompts interactively)
  if (type === "integration") {
    await generateCommand(cwd(), type, name || "");
    return;
  }

  if (!type || !name || !validTypes.includes(type)) {
    showCommandHelp("generate");
    exitProcess(2);
    return;
  }

  await generateCommand(cwd(), type, name);
}
