import type { ParsedArgs } from "#cli/shared/types";
import { projectCommand } from "./command.ts";

export async function handleProjectCommand(args: ParsedArgs): Promise<void> {
  if (args._[1] === "runs") {
    const { handleProjectRuns } = await import("./runs-handler.ts");
    await handleProjectRuns(args);
    return;
  }
  await projectCommand(args);
}
