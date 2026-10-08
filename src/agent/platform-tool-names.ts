/** Exact platform tool identities shared by lightweight hosted and runtime paths. */
export const LOAD_SKILL_TOOL_ID = "load_skill";
export const CANONICAL_LOAD_SKILL_TOOL_ID = `veryfront__${LOAD_SKILL_TOOL_ID}`;
export const FORM_INPUT_TOOL_ID = "form_input";
export const CANONICAL_FORM_INPUT_TOOL_ID = `veryfront__${FORM_INPUT_TOOL_ID}`;

export function isLoadSkillToolName(toolName: string): boolean {
  return toolName === LOAD_SKILL_TOOL_ID || toolName === CANONICAL_LOAD_SKILL_TOOL_ID;
}

export function isFormInputToolName(toolName: string): boolean {
  return toolName === FORM_INPUT_TOOL_ID || toolName === CANONICAL_FORM_INPUT_TOOL_ID;
}
