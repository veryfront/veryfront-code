/**
 * Skill Prompt Augmentation
 *
 * Builds the skill manifest section that gets appended to agent system prompts.
 *
 * @module
 */

import type { Skill } from "./types.ts";

const MAX_SKILL_MANIFEST_ENTRIES = 30;

function normalizePromptText(value: string, maxLength: number): string {
  let normalized = "";
  for (let index = 0; index < value.length && normalized.length < maxLength; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 9 || code === 10 || code === 13) {
      normalized += " ";
    } else if (code <= 31 || code === 127) {
      normalized += "\uFFFD";
    } else {
      normalized += value[index];
    }
  }
  return normalized.replace(/\s+/gu, " ").trim();
}

function escapeMarkdownInline(value: string): string {
  return value.replaceAll("\\", "\\\\").replace(/([`*_\[\]])/gu, "\\$1");
}

/**
 * Build the skill manifest prompt section for an agent's system prompt.
 *
 * Lists all available skills with their descriptions and instructions
 * on how to use the skill tools (load_skill, load_skill_reference, execute_skill_script).
 *
 * @param skills - Map of resolved skills for the agent
 * @returns Prompt section string, or empty string if no skills
 */
export function buildSkillManifestPrompt(skills: Map<string, Skill>): string {
  if (skills.size === 0) return "";

  const lines: string[] = [
    "## Available skills",
    "",
    "Use skills through tool calls. You must call `load_skill` to activate a skill before starting skill-specific work.",
    "",
  ];

  let displayed = 0;
  for (const [id, skill] of skills) {
    if (displayed >= MAX_SKILL_MANIFEST_ENTRIES) break;
    let description: unknown;
    try {
      description = skill.metadata.description;
    } catch {
      continue;
    }
    if (typeof id !== "string" || typeof description !== "string") continue;
    const safeId = escapeMarkdownInline(normalizePromptText(id, 256));
    const safeDescription = escapeMarkdownInline(normalizePromptText(description, 1_024));
    if (!safeId || !safeDescription) continue;
    lines.push(`- **${safeId}**: ${safeDescription}`);
    displayed += 1;
  }

  const omitted = Math.max(0, skills.size - displayed);
  if (omitted > 0) {
    lines.push(`- (${omitted} additional configured skills omitted from this bounded manifest)`);
  }

  lines.push("");
  lines.push("### Skill tools");
  lines.push("");
  lines.push("Call these as tools. Writing a tool name in text does not invoke it.");
  lines.push("");
  lines.push(
    "- `load_skill`: Use `{ skillId }` to load a skill's instructions and available references, resources, and scripts.",
  );
  lines.push(
    "- `load_skill_reference`: Use `{ skillId, reference }` only after `load_skill` lists the file for that skill.",
  );
  lines.push(
    "- `execute_skill_script`: Use `{ skillId, script, args?, env?, timeoutMs? }` only after `load_skill` lists the script for that skill.",
  );

  return lines.join("\n");
}
