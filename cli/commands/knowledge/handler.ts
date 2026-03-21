import type { ParsedArgs } from "#cli/shared/types";
import { knowledgeCommand } from "./command.ts";

export async function handleKnowledgeCommand(args: ParsedArgs): Promise<void> {
  await knowledgeCommand(args);
}
