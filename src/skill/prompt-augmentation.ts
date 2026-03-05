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
    "The following skills are available. Use `load-skill` to activate a skill and get its full instructions.",
    "",
  ];

  for (const [id, skill] of skills) {
    lines.push(`- **${id}**: ${skill.metadata.description}`);
  }

  lines.push("");
  lines.push("### Skill Tools");
  lines.push("");
  lines.push(
    "- `load-skill({ skillId })` — Load a skill's full instructions and see available references/scripts",
  );
  lines.push(
    "- `load-skill-reference({ skillId, reference })` — Read a reference file from the skill",
  );
  lines.push(
    "- `execute-skill-script({ skillId, script, args?, env?, timeoutMs? })` — Execute a script from the skill",
  );

  return lines.join("\n");
}
