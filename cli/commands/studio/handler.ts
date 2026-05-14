/**
 * Studio command handler
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";
import { studioCommand } from "./index.ts";

const getStudioArgsSchema = defineSchema((v) =>
  v.object({
    project: v.string().optional(),
    branch: v.string().optional(),
    file: v.string().optional(),
  })
);

const StudioArgsSchema = lazySchema(getStudioArgsSchema);

export const parseStudioArgs = createArgParser(StudioArgsSchema, {
  project: { keys: ["project"], type: "string", positional: 0 },
  branch: { keys: ["branch", "b"], type: "string" },
  file: { keys: ["file"], type: "string" },
});

export async function handleStudioCommand(args: ParsedArgs): Promise<void> {
  await studioCommand(parseArgsOrThrow(parseStudioArgs, "studio", args));
}
