/**
 * Studio command handler
 */

import type { ParsedArgs } from "../../shared/types.ts";
import { studioCommand } from "./index.ts";

export async function handleStudioCommand(args: ParsedArgs): Promise<void> {
  const project = typeof args._[1] === "string" ? args._[1] : undefined;
  const branch = typeof args.branch === "string" ? args.branch : undefined;
  const file = typeof args.file === "string" ? args.file : undefined;

  await studioCommand({ project, branch, file });
}
