import type { ParsedArgs } from "#cli/shared/types";
import { filesCommand } from "./command.ts";

export async function handleFilesCommand(args: ParsedArgs): Promise<void> {
  await filesCommand(args);
}
