import {
  KEEP_ROOT_ASSISTANT_VISIBLE_OWNER,
  LOAD_SKILL_CONTINUE_SAME_TURN,
  LOAD_SKILL_DELEGATION_THRESHOLD,
  LOAD_SKILL_OVERRIDE_FORWARDING,
  NO_DELEGATION_NARRATION_UNLESS_ASKED,
} from "./conversation-delegation-policy.ts";
import { createRuntimePromptBlock } from "./runtime-prompt-block.ts";
import type { RuntimeSkillDefinition } from "./runtime-skill-metadata.ts";

export const MAX_RUNTIME_SKILL_PROMPT_ENTRIES = 30;

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

export function buildRuntimeAvailableSkillsPromptBlock(
  skills: readonly RuntimeSkillDefinition[],
): string {
  const displaySkills = skills.slice(0, MAX_RUNTIME_SKILL_PROMPT_ENTRIES);
  const skillsList = displaySkills
    .map((skill) => `- ${skill.id}: ${skill.description}${formatRuntimeSkillMetadata(skill)}`)
    .join("\n");

  const truncationNote = skills.length > MAX_RUNTIME_SKILL_PROMPT_ENTRIES
    ? `\n\n(${
      skills.length - MAX_RUNTIME_SKILL_PROMPT_ENTRIES
    } more skills available — use load_skill to discover)`
    : "";

  return createRuntimePromptBlock({
    name: "available_skills",
    content:
      `You have access to these skills. Use load_skill to load full instructions when needed. load_skill only loads instructions plus metadata. ${LOAD_SKILL_CONTINUE_SAME_TURN} ${KEEP_ROOT_ASSISTANT_VISIBLE_OWNER} If a skill specifies allowed tools, you MUST stay within the current-run intersection of those tools. When delegating, use the platform orchestration tool \`invoke_agent\`. ${LOAD_SKILL_DELEGATION_THRESHOLD} ${LOAD_SKILL_OVERRIDE_FORWARDING} ${NO_DELEGATION_NARRATION_UNLESS_ASKED}

Do NOT attempt tools that are absent from the current run just because they appear in loaded skill instructions.

${skillsList}${truncationNote}`,
  });
}
