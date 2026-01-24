import type { ParsedArgs } from "./types.ts";
import { studioCommand } from "../commands/studio.ts";
import { cliLogger } from "#veryfront/utils";
import { formatUserError } from "#veryfront/errors/user-friendly/index.ts";
import { exitProcess } from "../utils/index.ts";

export async function handleStudioCommand(args: ParsedArgs): Promise<void> {
  const project = args._[1];
  const branch = args.branch;
  const file = args.file;

  try {
    await studioCommand({
      project: typeof project === "string" ? project : undefined,
      branch: typeof branch === "string" ? branch : undefined,
      file: typeof file === "string" ? file : undefined,
    });
  } catch (error) {
    const formattedError = error instanceof Error ? formatUserError(error) : String(error);
    cliLogger.error(formattedError);
    exitProcess(1);
  }
}
