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
  SkillScriptSnapshot,
  SkillScriptSnapshotFile,
} from "./types.ts";

export {
  isSkillInfrastructureToolId,
  isValidProviderSafeSkillId,
  isValidSkillName,
  isValidStrictSkillName,
  SKILL_ALLOWED_TOOL_PATTERN_REGEX,
  SKILL_ASSETS_DIR,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_MD_FILENAME,
  SKILL_METADATA_KEY_MAX_LENGTH,
  SKILL_METADATA_MAX_ENTRIES,
  SKILL_METADATA_VALUE_MAX_LENGTH,
  SKILL_NAME_REGEX,
  SKILL_READABLE_DIRS,
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
export {
  parseSkillFileFrontmatter,
  parseSkillFrontmatter,
  validateSkillFileMetadata,
  validateSkillMetadata,
} from "./parser.ts";

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

// Skill tool availability
export {
  filterToolNamesForSkill,
  filterToolsForSkill,
  isSkillToolAvailable,
} from "./allowed-tools.ts";

export type { ParsedSkillContent } from "./document-parser.ts";
export { parseBoundedSkillDocument } from "./document-parser.ts";
