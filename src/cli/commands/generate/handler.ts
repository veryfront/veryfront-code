/**
 * Generate command handler
 */

import { generateCommand } from "./index.ts";
import { showCommandHelp } from "../../help/index.ts";
import { exitProcess, showLogo } from "../../utils/index.ts";
import type { GenerateCommandArgs } from "../../shared/types.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";

const VALID_TYPES = ["page", "layout", "provider", "api", "integration"] as const;

export async function handleGenerateCommand(args: GenerateCommandArgs): Promise<void> {
  showLogo();
  const type = args._[1];
  const name = args._[2];

  // Integration type doesn't require a name (prompts interactively)
  if (type === "integration") {
    await generateCommand(cwd(), type, String(name ?? ""));
    return;
  }

  if (
    typeof type !== "string" || !VALID_TYPES.includes(type as typeof VALID_TYPES[number]) || !name
  ) {
    showCommandHelp("generate");
    exitProcess(2);
    return;
  }

  await generateCommand(cwd(), type, String(name));
}
