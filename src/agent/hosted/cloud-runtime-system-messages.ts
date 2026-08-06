import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import type { RuntimeAgentMarkdownDefinition } from "../runtime/agent-definition.ts";
import type { HostedChatRuntimeInstructionsInput } from "./chat-preparation.ts";
import { buildAgentCallContext } from "../runtime/call-context.ts";
import type { AgentCallCacheTtl } from "../runtime/call-context.ts";
import type { RuntimeSkillDefinition } from "../runtime/skill-metadata.ts";

/** Input payload for create Veryfront Cloud runtime system messages. */
export type CreateVeryfrontCloudRuntimeSystemMessagesInput = {
  agent: RuntimeAgentMarkdownDefinition;
  instructions?: string;
  skills?: readonly RuntimeSkillDefinition[];
  availableToolNames?: readonly string[];
  projectId?: string | null;
  branchId?: string | null;
  environmentContext?: string;
  /** Prompt-cache TTL for the static (Layer 0) message. Default `"5m"`. */
  cacheTtl?: AgentCallCacheTtl;
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
    ...(input.availableToolNames === undefined
      ? {}
      : { availableToolNames: input.availableToolNames }),
    ...(input.environmentContext === undefined
      ? {}
      : { environmentContext: input.environmentContext }),
    ...(input.cacheTtl === undefined ? {} : { cacheTtl: input.cacheTtl }),
  });
}

/** Options for building Veryfront Cloud runtime instructions. */
export type BuildVeryfrontCloudRuntimeInstructionsOptions = {
  /**
   * Prompt-cache TTL for the static (Layer 0) message. Set `"1h"` only for
   * interactive multi-turn runs (root chat, steering refresh) where a second
   * read is likely; leave default `"5m"` for one-shot child/eval runs. See
   * RFC 0001 (TTL gating decision).
   */
  cacheTtl?: AgentCallCacheTtl;
};

/** Builds Veryfront Cloud runtime instructions. */
export function buildVeryfrontCloudRuntimeInstructions(
  input: HostedChatRuntimeInstructionsInput<RuntimeAgentMarkdownDefinition>,
  options?: BuildVeryfrontCloudRuntimeInstructionsOptions,
): ChatSystemMessage[] {
  return createVeryfrontCloudRuntimeSystemMessages({
    agent: input.agentConfig,
    instructions: input.instructions || undefined,
    skills: input.skills.length > 0 ? input.skills : undefined,
    availableToolNames: input.availableToolNames,
    projectId: input.projectId,
    branchId: input.branchId,
    environmentContext: input.environmentContext,
    ...(options?.cacheTtl === undefined ? {} : { cacheTtl: options.cacheTtl }),
  });
}
