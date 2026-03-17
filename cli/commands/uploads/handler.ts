import type { ParsedArgs } from "#cli/shared/types";
import { uploadsCommand } from "./command.ts";

export async function handleUploadsCommand(args: ParsedArgs): Promise<void> {
  await uploadsCommand(args);
}
