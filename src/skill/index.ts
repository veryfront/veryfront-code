/**
 * Agent skills.
 *
 * Public API for the agent skills system.
 * Skills are project-level capabilities defined as SKILL.md files
 * using the Agent Skills metadata format and Veryfront's documented,
 * fail-closed allowed-tools subset.
 *
 * @module
 *
 * @example
 * ```ts
 * import { parseSkillFrontmatter, validateSkillFileMetadata } from "veryfront/skill";
 *
 * const parsed = await parseSkillFrontmatter("---\nname: review\ndescription: Review code\n---\n");
 * validateSkillFileMetadata(parsed.frontmatter, "review");
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
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_MD_FILENAME,
  SKILL_NAME_REGEX,
  SKILL_READABLE_DIRS,
  SKILL_REFERENCES_DIR,
  SKILL_RESOURCES_DIR,
  SKILL_SCRIPTS_DIR,
  SKILL_STRICT_NAME_REGEX,
  SKILL_TOOL_IDS,
} from "./types.ts";
export {
  SKILL_RELATIVE_PATH_MAX_LENGTH,
  SKILL_SUBDIR_MAX_ENTRIES,
  SKILL_TEXT_FILE_MAX_BYTES,
} from "./limits.ts";

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
export {
  parseSkillFileFrontmatter,
  parseSkillFrontmatter,
  parseUnsafeLegacySkillFrontmatter,
  validateSkillFileMetadata,
  validateSkillMetadata,
} from "./parser.ts";

// Path Safety
export {
  listSkillSubdir,
  listStrictSkillSubdir,
  validateSkillPath,
  validateStrictSkillPath,
} from "./path-safety.ts";

// Bounded file access
export { readBoundedSkillTextFile } from "./bounded-text-file.ts";

// Tools
export {
  createExecuteSkillScriptTool,
  createLoadSkillReferenceTool,
  createLoadSkillTool,
} from "./tools.ts";

// Executor
export { getSkillScriptExecutor } from "./executor.ts";

// Prompt
export {
  buildSkillManifestPrompt,
  buildUnsafeLegacySkillManifestPrompt,
} from "./prompt-augmentation.ts";

// Allowed-Tools
export {
  filterToolsForSkill,
  isToolAllowedBySkill,
  validateAllowedToolPatterns,
} from "./allowed-tools.ts";
