/**
 * Agent skills.
 *
 * Public API for the agent skills system.
 * Skills are project-level capabilities defined as SKILL.md files
 * following the agentskills.io specification.
 *
 * @module
 *
 * @example
 * ```ts
 * import { parseSkillFrontmatter, validateSkillMetadata } from "veryfront/skill";
 *
 * const parsed = await parseSkillFrontmatter("---\nname: review\ndescription: Review code\n---\n");
 * validateSkillMetadata(parsed.frontmatter, "review");
 * ```
 */

// Types
export type {
  ActiveSkillContext,
  Skill,
  SkillContent,
  SkillMetadata,
  SkillScriptExecutor,
  SkillScriptExecutorInput,
  SkillScriptResult,
} from "./types.ts";

export {
  SKILL_ALLOWED_TOOL_PATTERN_REGEX,
  SKILL_ASSETS_DIR,
  SKILL_COMPATIBILITY_MAX_LENGTH,
  SKILL_DEFINITION_MAX_BYTES,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_MD_FILENAME,
  SKILL_NAME_REGEX,
  SKILL_REFERENCES_DIR,
  SKILL_RESOURCES_DIR,
  SKILL_SCRIPTS_DIR,
  SKILL_TOOL_IDS,
} from "./types.ts";

// Registry
export {
  type AgentCapabilityScope,
  getAllSkills,
  getSkill,
  isSkillVisibleTo,
  registerSkill,
  skillRegistry,
} from "./registry.ts";

// Parser
export { type ParsedSkillContent, parseSkillFrontmatter, validateSkillMetadata } from "./parser.ts";

// Path Safety
export { listSkillSubdir, validateSkillPath } from "./path-safety.ts";

// Tools
export {
  createExecuteSkillScriptTool,
  createLoadSkillReferenceTool,
  createLoadSkillTool,
} from "./tools.ts";

// Executor
export { getSkillScriptExecutor } from "./executor.ts";

// Prompt
export { buildSkillManifestPrompt } from "./prompt-augmentation.ts";

// Allowed-Tools
export {
  filterToolsForSkill,
  isToolAllowedBySkill,
  type SkillToolAvailability,
  validateAllowedToolPatterns,
} from "./allowed-tools.ts";
