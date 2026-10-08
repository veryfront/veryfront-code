import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import type { AgentCallCacheTtl } from "#veryfront/agent/runtime/call-context.ts";
import type { RuntimeAgentMarkdownDefinition } from "../runtime/agent-definition.ts";
import type { HostedChatRuntimeInstructionsInput } from "./chat-preparation.ts";
import { buildAgentCallContext } from "../runtime/call-context.ts";
import type { RuntimeSkillLoaderToolName } from "../runtime/skill-prompt.ts";
import type { RuntimeSkillDefinition } from "../runtime/skill-metadata.ts";
import { CANONICAL_LOAD_SKILL_TOOL_ID, LOAD_SKILL_TOOL_ID } from "../platform-tool-names.ts";

/** Input payload for create Veryfront Cloud runtime system messages. */
export type CreateVeryfrontCloudRuntimeSystemMessagesInput = {
  agent: RuntimeAgentMarkdownDefinition;
  instructions?: string;
  skills?: readonly RuntimeSkillDefinition[];
  projectId?: string | null;
  branchId?: string | null;
  environmentContext?: string;
  /** Prompt-cache TTL for the static (Layer 0) message. Default `"5m"`. */
  cacheTtl?: AgentCallCacheTtl;
  /** Exposed platform skill loader used by bounded inventory discovery. */
  skillLoaderToolName?: RuntimeSkillLoaderToolName;
};

/** Resolve the model-visible hosted skill loader spelling from exposed tools. */
export function resolveHostedRuntimeSkillLoaderToolName(
  availableToolNames?: readonly string[],
): RuntimeSkillLoaderToolName | undefined {
  if (availableToolNames === undefined) return undefined;
  if (availableToolNames.includes(LOAD_SKILL_TOOL_ID)) return LOAD_SKILL_TOOL_ID;
  if (availableToolNames.includes(CANONICAL_LOAD_SKILL_TOOL_ID)) {
    return CANONICAL_LOAD_SKILL_TOOL_ID;
  }
  return undefined;
}

/** Create Veryfront Cloud runtime system messages. */
export function createVeryfrontCloudRuntimeSystemMessages(
  input: CreateVeryfrontCloudRuntimeSystemMessagesInput,
): ChatSystemMessage[] {
  const instructions = Array.isArray(input.agent.system) && input.agent.system.length === 0
    ? input.agent.instructions
    : input.agent.system ?? input.agent.instructions;
  return buildAgentCallContext({
    instructions,
    anthropicProviderAlias: "veryfront-cloud",
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
    ...(input.skillLoaderToolName === undefined
      ? {}
      : { skillLoaderToolName: input.skillLoaderToolName }),
    ...(input.environmentContext === undefined
      ? {}
      : { environmentContext: input.environmentContext }),
    ...(input.cacheTtl === undefined ? {} : { cacheTtl: input.cacheTtl }),
  });
}

/** Options for building Veryfront Cloud runtime instructions. */
export type BuildVeryfrontCloudRuntimeInstructionsOptions = {
  /**
   * Prompt-cache TTL for the static (Layer 0) message. Set `"1h"` for
   * interactive multi-turn runs, including root chat, steering refresh, and
   * tool-assembly re-rendering, where a second read is likely. Leave the
   * default `"5m"` for one-shot child/eval runs. See RFC 0001.
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
    skills: input.skills,
    skillLoaderToolName: input.skillLoaderToolName ??
      resolveHostedRuntimeSkillLoaderToolName(input.availableToolNames),
    projectId: input.projectId,
    branchId: input.branchId,
    environmentContext: input.environmentContext,
    ...(options?.cacheTtl === undefined ? {} : { cacheTtl: options.cacheTtl }),
  });
}

/** Builds runtime instructions for an interactive run with a one-hour cache TTL. */
export function buildInteractiveVeryfrontCloudRuntimeInstructions(
  input: HostedChatRuntimeInstructionsInput<RuntimeAgentMarkdownDefinition>,
): ChatSystemMessage[] {
  return buildVeryfrontCloudRuntimeInstructions(input, { cacheTtl: "1h" });
}
