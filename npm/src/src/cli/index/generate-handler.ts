/**
 * Generate command handler for CLI
 *
 * @module cli/index/generate-handler
 */

import { generateCommand } from "../commands/generate.js";
import { showCommandHelp } from "../help/index.js";
import { exitProcess } from "../utils/index.js";
import type { GenerateCommandArgs } from "./types.js";
import { cwd } from "../../platform/compat/process.js";

export async function handleGenerateCommand(args: GenerateCommandArgs): Promise<void> {
  const type = args._[1];
  const name = args._[2];
  const validTypes = ["page", "layout", "provider", "api", "integration"];

  // Integration type doesn't require a name (prompts interactively)
  if (type === "integration") {
    await generateCommand(cwd(), type, String(name ?? ""));
    return;
  }

  if (!type || !name || typeof type !== "string" || !validTypes.includes(type)) {
    showCommandHelp("generate");
    exitProcess(2);
    return;
  }

  await generateCommand(cwd(), type, String(name));
}
