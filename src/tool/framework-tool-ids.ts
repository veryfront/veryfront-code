/** Tool IDs reserved for framework-owned skill infrastructure. */
export const SKILL_TOOL_ID_VALUES = [
  "load_skill",
  "load_skill_reference",
  "execute_skill_script",
] as const;

const SKILL_TOOL_ID_LOOKUP: ReadonlySet<string> = new Set(SKILL_TOOL_ID_VALUES);

/** Return whether an ID belongs to framework-owned skill infrastructure. */
export function isFrameworkSkillToolId(id: string): boolean {
  return SKILL_TOOL_ID_LOOKUP.has(id);
}
