/**
 * Routes command handler
 */

import { cwd } from "#veryfront/platform/compat/process.ts";
import { routesCommand } from "./command.ts";
import type { ParsedArgs } from "../../index/types.ts";

export async function handleRoutesCommand(args: ParsedArgs): Promise<void> {
  const projectDir = typeof args.project === "string" ? args.project : cwd();

  await routesCommand(projectDir, {
    json: args.json === true,
  });
}
