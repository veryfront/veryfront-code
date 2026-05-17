import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import {
  createRuntimeAgentSystemMessages,
  type RuntimeAgentMarkdownDefinition,
} from "../runtime/agent-definition.ts";
import type { HostedChatRuntimeInstructionsInput } from "./chat-preparation.ts";
import { createRuntimePromptBlock } from "../runtime/prompt-block.ts";
import type { RuntimeSkillDefinition } from "../runtime/skill-metadata.ts";

export type CreateVeryfrontCloudRuntimeSystemMessagesInput = {
  agent: RuntimeAgentMarkdownDefinition;
  instructions?: string;
  skills?: readonly RuntimeSkillDefinition[];
  projectId?: string | null;
  branchId?: string | null;
  environmentContext?: string;
};

function createProjectInstructionsBlock(instructions: string): string {
  return createRuntimePromptBlock({
    name: "project_instructions",
    content: `CRITICAL: You MUST follow these project-specific guidelines:\n\n${instructions}`,
  });
}

function createProjectContextBlock(input: { projectId: string; branchId?: string | null }): string {
  const branchLine = input.branchId
    ? `branch_id: "${input.branchId}"`
    : "branch_id: main (no branch_id needed for file operations)";

  return createRuntimePromptBlock({
    name: "project_context",
    content: `project_reference: "${input.projectId}"
${branchLine}

Use the exact project_reference above for project/platform tools unless a tool result explicitly confirms a different active project.

CRITICAL: Do NOT guess or invent project references. If a tool requires project_reference, use the value above.`,
  });
}

export function createVeryfrontCloudRuntimeSystemMessages(
  input: CreateVeryfrontCloudRuntimeSystemMessagesInput,
): ChatSystemMessage[] {
  const runtimeBlocks: string[] = [];

  if (input.instructions) {
    runtimeBlocks.push(createProjectInstructionsBlock(input.instructions));
  }

  if (input.projectId) {
    runtimeBlocks.push(
      createProjectContextBlock({
        projectId: input.projectId,
        branchId: input.branchId,
      }),
    );
  }

  return createRuntimeAgentSystemMessages({
    agent: input.agent,
    runtimeBlocks,
    skills: input.skills,
    environmentContext: input.environmentContext,
  });
}

export function buildVeryfrontCloudRuntimeInstructions(
  input: HostedChatRuntimeInstructionsInput<RuntimeAgentMarkdownDefinition>,
): ChatSystemMessage[] {
  return createVeryfrontCloudRuntimeSystemMessages({
    agent: input.agentConfig,
    instructions: input.instructions || undefined,
    skills: input.skills.length > 0 ? input.skills : undefined,
    projectId: input.projectId,
    branchId: input.branchId,
    environmentContext: input.environmentContext,
  });
}
