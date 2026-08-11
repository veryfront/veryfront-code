import type { ParsedArgs } from "#cli/shared/types";
import { projectCommand } from "./command.ts";

export async function handleProjectCommand(args: ParsedArgs): Promise<void> {
  await projectCommand(args);
}
