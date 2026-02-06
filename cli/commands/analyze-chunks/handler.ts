/**
 * Analyze chunks command handler
 */

import { z } from "zod";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { analyzeChunksCommand } from "./command.ts";
import { showLogo } from "#cli/utils";
import { CommonArgs, createArgParser } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

const AnalyzeChunksArgsSchema = z.object({
  projectDir: z.string().default(""),
  output: z.string().optional(),
});

export const parseAnalyzeChunksArgs = createArgParser(AnalyzeChunksArgsSchema, {
  projectDir: CommonArgs.projectDir,
  output: CommonArgs.output,
});

export async function handleAnalyzeChunksCommand(args: ParsedArgs): Promise<void> {
  showLogo();
  const result = parseAnalyzeChunksArgs(args);
  if (!result.success) {
    throw new Error(`Invalid analyze-chunks arguments: ${result.error.message}`);
  }
  await analyzeChunksCommand({
    projectDir: result.data.projectDir || cwd(),
    output: result.data.output,
  });
}
