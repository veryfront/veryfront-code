import type { ParsedArgs } from "./types.js";
import { studioCommand } from "../commands/studio.js";
import { cliLogger } from "../../utils/index.js";
import { formatUserError } from "../../errors/user-friendly/index.js";
import { exitProcess } from "../utils/index.js";

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
