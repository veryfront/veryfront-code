/**
 * Skill Prompt Augmentation
 *
 * Builds the skill manifest section that gets appended to agent system prompts.
 *
 * @module
 */

import type { Skill } from "./types.ts";

/** Maximum number of skills rendered in an agent system prompt. */
export const MAX_SKILL_MANIFEST_PROMPT_ENTRIES = 30;

/**
 * Build the skill manifest prompt section for an agent's system prompt.
 *
 * Lists up to the prompt entry limit with descriptions and instructions on
 * how to use the skill tools (load_skill, load_skill_reference, execute_skill_script).
 *
 * @param skills - Map of resolved skills for the agent
 * @returns Prompt section string, or empty string if no skills
 */
export function buildSkillManifestPrompt(skills: Map<string, Skill>): string {
  if (skills.size === 0) return "";

  const lines: string[] = [
    "## Available Skills",
    "",
    "You have access to skills via tool calling. IMPORTANT: You MUST call the load_skill tool (not write it as text) to activate a skill before performing skill-related tasks.",
    "",
  ];

  let displayedSkillCount = 0;
  for (const [id, skill] of skills) {
    lines.push(`- **${id}**: ${skill.metadata.description}`);
    displayedSkillCount += 1;
    if (displayedSkillCount === MAX_SKILL_MANIFEST_PROMPT_ENTRIES) {
      break;
    }
  }

  if (skills.size > MAX_SKILL_MANIFEST_PROMPT_ENTRIES) {
    lines.push("");
    lines.push(
      `${
        skills.size - MAX_SKILL_MANIFEST_PROMPT_ENTRIES
      } more skill summaries omitted from this prompt. Call load_skill only with a known skill ID.`,
    );
  }

  lines.push("");
  lines.push("### Skill Tools (call these as tools, never write them as text)");
  lines.push("");
  lines.push(
    "- load_skill: Call with { skillId } to load a skill's full instructions and available references/resources/scripts",
  );
  lines.push(
    "- load_skill_reference: Call with { skillId, reference } only after load_skill lists reference files for that skill",
  );
  lines.push(
    "- execute_skill_script: Call with { skillId, script, args?, env?, timeoutMs? } only after load_skill lists scripts for that skill",
  );

  return lines.join("\n");
}
