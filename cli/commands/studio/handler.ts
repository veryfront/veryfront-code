/**
 * Studio command handler
 */

import { z } from "zod";
import { createArgParser } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";
import { studioCommand } from "./index.ts";

const StudioArgsSchema = z.object({
  project: z.string().optional(),
  branch: z.string().optional(),
  file: z.string().optional(),
});

export const parseStudioArgs = createArgParser(StudioArgsSchema, {
  project: { keys: ["project"], type: "string", positional: 0 },
  branch: { keys: ["branch", "b"], type: "string" },
  file: { keys: ["file"], type: "string" },
});

export async function handleStudioCommand(args: ParsedArgs): Promise<void> {
  const result = parseStudioArgs(args);
  if (!result.success) {
    throw new Error(`Invalid studio arguments: ${result.error.message}`);
  }
  await studioCommand(result.data);
}
