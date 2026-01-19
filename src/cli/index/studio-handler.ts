import type { ParsedArgs } from "./types.ts";
import { studioCommand } from "../commands/studio.ts";
import { cliLogger } from "#veryfront/utils";
import { formatUserError } from "#veryfront/errors/user-friendly/index.ts";
import { exitProcess } from "../utils/index.ts";

export async function handleStudioCommand(args: ParsedArgs): Promise<void> {
  // Project is optional - will be auto-detected if not provided
  const project = args._[1] as string | undefined;
  const branch = args.branch as string | undefined;
  const file = args.file as string | undefined;

  try {
    await studioCommand({
      project, // undefined = auto-detect
      branch,
      file,
    });
  } catch (error) {
    const formattedError = error instanceof Error ? formatUserError(error) : String(error);
    cliLogger.error(formattedError);
    exitProcess(1);
  }
}
