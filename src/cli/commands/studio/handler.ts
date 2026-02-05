/**
 * Studio command handler
 */

import type { ParsedArgs } from "../../shared/types.ts";
import { studioCommand } from "./index.ts";
import { cliLogger } from "#veryfront/utils";
import { formatUserError } from "#veryfront/errors/user-friendly/index.ts";
import { exitProcess } from "../../utils/index.ts";

export async function handleStudioCommand(args: ParsedArgs): Promise<void> {
  const project = typeof args._[1] === "string" ? args._[1] : undefined;
  const branch = typeof args.branch === "string" ? args.branch : undefined;
  const file = typeof args.file === "string" ? args.file : undefined;

  try {
    await studioCommand({ project, branch, file });
  } catch (error) {
    cliLogger.error(error instanceof Error ? formatUserError(error) : String(error));
    exitProcess(1);
  }
}
