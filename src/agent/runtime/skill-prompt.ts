import {
  KEEP_ROOT_ASSISTANT_VISIBLE_OWNER,
  LOAD_SKILL_CONTINUE_SAME_TURN,
  LOAD_SKILL_DELEGATION_THRESHOLD,
  LOAD_SKILL_OVERRIDE_FORWARDING,
  NO_DELEGATION_NARRATION_UNLESS_ASKED,
} from "../conversation/delegation-policy.ts";
import { createRuntimePromptBlock } from "./prompt-block.ts";
import type { RuntimeSkillDefinition } from "./skill-metadata.ts";

/** Maximum value for runtime skill prompt entries. */
export const MAX_RUNTIME_SKILL_PROMPT_ENTRIES = 30;

function getScopedDelegateToolNames(availableToolNames?: readonly string[]): string[] {
  return (availableToolNames ?? [])
    .filter((toolName) => toolName.startsWith("agent_"))
    .sort();
}

function buildRuntimeSkillDelegationGuidance(availableToolNames?: readonly string[]): string {
  if (availableToolNames === undefined) {
    return `When delegating, use an available scoped \`agent_<id>\` tool; use \`invoke_agent\` only when that exact legacy tool is present. ${LOAD_SKILL_DELEGATION_THRESHOLD} ${LOAD_SKILL_OVERRIDE_FORWARDING}`;
  }

  const scopedDelegateToolNames = getScopedDelegateToolNames(availableToolNames);
  if (scopedDelegateToolNames.length > 0) {
    const tools = scopedDelegateToolNames.map((toolName) => `\`${toolName}\``).join(", ");
    return `When delegating, use only these available scoped delegation tools: ${tools}. ${LOAD_SKILL_DELEGATION_THRESHOLD}`;
  }

  if (availableToolNames.includes("invoke_agent")) {
    return `When delegating, use the available legacy \`invoke_agent\` tool. ${LOAD_SKILL_DELEGATION_THRESHOLD} ${LOAD_SKILL_OVERRIDE_FORWARDING}`;
  }

  return "";
}

/** Formats runtime skill metadata. */
export function formatRuntimeSkillMetadata(skill: RuntimeSkillDefinition): string {
  const details: string[] = [];
  const allowedTools = skill.allowedTools ?? [];

  if (allowedTools.length > 0) {
    details.push(`tools: ${allowedTools.join(", ")}`);
  }

  if (skill.model) {
    details.push(`model: ${skill.model}`);
  }

  if (skill.thinking === false) {
    details.push("thinking: off");
  } else if (typeof skill.thinking === "number") {
    details.push(`thinking: ${skill.thinking}`);
  }

  if (skill.maxSteps !== undefined) {
    details.push(`max-steps: ${skill.maxSteps}`);
  }

  return details.length > 0 ? ` (${details.join("; ")})` : "";
}

function formatRuntimeSkillLabel(skill: RuntimeSkillDefinition): string {
  return skill.name === skill.id ? skill.id : `${skill.name} (\`${skill.id}\`)`;
}

/** Builds runtime available skills prompt block. */
export function buildRuntimeAvailableSkillsPromptBlock(
  skills: readonly RuntimeSkillDefinition[],
  options: { availableToolNames?: readonly string[] } = {},
): string {
  const displaySkills = skills.slice(0, MAX_RUNTIME_SKILL_PROMPT_ENTRIES);
  const skillsList = displaySkills
    .map((skill) =>
      `- ${formatRuntimeSkillLabel(skill)}: ${skill.description}${
        formatRuntimeSkillMetadata(skill)
      }`
    )
    .join("\n");

  const truncationNote = skills.length > MAX_RUNTIME_SKILL_PROMPT_ENTRIES
    ? `\n\n(${
      skills.length - MAX_RUNTIME_SKILL_PROMPT_ENTRIES
    } more skill summaries omitted from this prompt; use an ID from the load_skill tool schema)`
    : "";
  const delegationGuidance = buildRuntimeSkillDelegationGuidance(options.availableToolNames);
  const delegationSentence = delegationGuidance ? ` ${delegationGuidance}` : "";

  return createRuntimePromptBlock({
    name: "available_skills",
    content:
      `You have access to these skills. Use load_skill to load full instructions when needed. load_skill only loads instructions plus metadata. ${LOAD_SKILL_CONTINUE_SAME_TURN} ${KEEP_ROOT_ASSISTANT_VISIBLE_OWNER} If a skill specifies allowed tools, you MUST stay within the current-run intersection of those tools.${delegationSentence} ${NO_DELEGATION_NARRATION_UNLESS_ASKED}

Do NOT attempt tools that are absent from the current run just because they appear in loaded skill instructions.

${skillsList}${truncationNote}`,
  });
}
