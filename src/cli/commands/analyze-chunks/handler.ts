/**
 * Analyze chunks command handler
 */

import { cwd } from "#veryfront/platform/compat/process.ts";
import { analyzeChunksCommand } from "./command.ts";
import { showLogo } from "../../utils/index.ts";
import type { ParsedArgs } from "../../shared/types.ts";

export async function handleAnalyzeChunksCommand(args: ParsedArgs): Promise<void> {
  showLogo();
  const projectDir = typeof args.project === "string" ? args.project : cwd();
  const output = typeof args.output === "string" ? args.output : undefined;

  await analyzeChunksCommand({
    projectDir,
    output,
  });
}
