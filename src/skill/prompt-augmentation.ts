/**
 * Skill Prompt Augmentation
 *
 * Builds the skill manifest section that gets appended to agent system prompts.
 *
 * @module
 */

import type { Skill } from "./types.ts";

/**
 * Build the skill manifest prompt section for an agent's system prompt.
 *
 * Lists all available skills with their descriptions and instructions
 * on how to use the skill tools (load-skill, load-skill-reference, execute-skill-script).
 *
 * @param skills - Map of resolved skills for the agent
 * @returns Prompt section string, or empty string if no skills
 */
export function buildSkillManifestPrompt(skills: Map<string, Skill>): string {
  if (skills.size === 0) return "";

  const lines: string[] = [
    "## Available Skills",
    "",
    "You have access to skills via tool calling. IMPORTANT: You MUST call the load-skill tool (not write it as text) to activate a skill before performing skill-related tasks.",
    "",
  ];

  for (const [id, skill] of skills) {
    lines.push(`- **${id}**: ${skill.metadata.description}`);
  }

  lines.push("");
  lines.push("### Skill Tools (call these as tools, never write them as text)");
  lines.push("");
  lines.push(
    "- load-skill: Call with { skillId } to load a skill's full instructions and available references/scripts",
  );
  lines.push(
    "- load-skill-reference: Call with { skillId, reference } to read a reference file from the skill",
  );
  lines.push(
    "- execute-skill-script: Call with { skillId, script, args?, env?, timeoutMs? } to execute a script",
  );

  return lines.join("\n");
}
