/**
 * Clean command handler
 */

import { cwd } from "#veryfront/platform/compat/process.ts";
import { cleanCommand } from "./command.ts";
import type { ParsedArgs } from "../../index/types.ts";

export async function handleCleanCommand(args: ParsedArgs): Promise<void> {
  const projectDir = typeof args.project === "string" ? args.project : cwd();

  await cleanCommand({
    projectDir,
    cache: args.cache === true,
    build: args.build === true,
    all: args.all === true,
    force: args.force === true || args.f === true || args.y === true,
  });
}
