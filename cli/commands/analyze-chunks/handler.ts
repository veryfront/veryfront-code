/**
 * Analyze chunks command handler
 */

import { z } from "zod";
import { cwd } from "veryfront/platform";
import { analyzeChunksCommand } from "./command.ts";
import { showLogo } from "#cli/utils";
import { CommonArgs, createArgParser, parseArgsOrThrow } from "#cli/shared/args";
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
  const data = parseArgsOrThrow(parseAnalyzeChunksArgs, "analyze-chunks", args);
  await analyzeChunksCommand({
    projectDir: data.projectDir || cwd(),
    output: data.output,
  });
}
