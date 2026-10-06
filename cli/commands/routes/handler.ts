/**
 * Routes command handler
 */

import { defineSchema, lazySchema } from "veryfront/schemas";
import { cwd } from "veryfront/platform";
import { routesCommand } from "./command.ts";
import { showHeader } from "#cli/utils";
import { CommonArgs, createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import { isJsonMode } from "../../shared/json-output.ts";
import type { ParsedArgs } from "#cli/shared/types";

const getRoutesArgsSchema = defineSchema((v) =>
  v.object({
    projectDir: v.string().default(""),
    json: v.boolean().default(false),
  })
);

const RoutesArgsSchema = lazySchema(getRoutesArgsSchema);

export const parseRoutesArgs = createArgParser(RoutesArgsSchema, {
  projectDir: CommonArgs.projectDir,
  json: { keys: ["json", "j"], type: "boolean" },
}, { rejectUnknown: true });

export async function handleRoutesCommand(args: ParsedArgs): Promise<void> {
  const data = parseArgsOrThrow(parseRoutesArgs, "routes", args);
  if (!isJsonMode()) showHeader();
  const projectDir = data.projectDir || cwd();
  await routesCommand(projectDir, { json: data.json });
}
