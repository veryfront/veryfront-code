import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import type { RuntimeAgentMarkdownDefinition } from "../runtime/agent-definition.ts";
import type { HostedChatRuntimeInstructionsInput } from "./chat-preparation.ts";
import { buildAgentCallContext } from "../runtime/call-context.ts";
import type { RuntimeSkillDefinition } from "../runtime/skill-metadata.ts";

/** Input payload for create Veryfront Cloud runtime system messages. */
export type CreateVeryfrontCloudRuntimeSystemMessagesInput = {
  agent: RuntimeAgentMarkdownDefinition;
  instructions?: string;
  skills?: readonly RuntimeSkillDefinition[];
  projectId?: string | null;
  branchId?: string | null;
  environmentContext?: string;
};

/** Create Veryfront Cloud runtime system messages. */
export function createVeryfrontCloudRuntimeSystemMessages(
  input: CreateVeryfrontCloudRuntimeSystemMessagesInput,
): ChatSystemMessage[] {
  return buildAgentCallContext({
    instructions: input.agent.instructions,
    ...(input.instructions ? { projectInstructions: input.instructions } : {}),
    ...(input.projectId
      ? {
        projectContext: {
          projectId: input.projectId,
          ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
        },
      }
      : {}),
    ...(input.skills === undefined ? {} : { skills: input.skills }),
    ...(input.environmentContext === undefined
      ? {}
      : { environmentContext: input.environmentContext }),
  });
}

/** Builds Veryfront Cloud runtime instructions. */
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
