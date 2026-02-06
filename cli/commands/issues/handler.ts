/**
 * Issues command handler
 */

import { issuesCommand } from "./command.ts";
import type { ParsedArgs } from "#cli/shared/types";

export async function handleIssuesCommand(args: ParsedArgs): Promise<void> {
  await issuesCommand(args);
}
