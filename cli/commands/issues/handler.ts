/**
 * Issues command handler
 */

import { type IssuesArgs, issuesCommand } from "./command.ts";

export async function handleIssuesCommand(args: IssuesArgs): Promise<void> {
  await issuesCommand(args);
}
