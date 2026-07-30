---
title: "veryfront/skill"
description: "Agent skills. Public API for the agent skills system. Skills are project-level capabilities defined as SKILL.md files using the Agent Skills metadata format and Veryfront's documented, fail-closed allowed-tools subset."
order: 33
---

## Import

```ts
import {
  buildSkillManifestPrompt,
  createExecuteSkillScriptTool,
  createLoadSkillReferenceTool,
  createLoadSkillTool,
  filterToolsForSkill,
  getAllSkills,
} from "veryfront/skill";
```

## Examples

```ts
import { parseSkillFrontmatter, validateSkillFileMetadata } from "veryfront/skill";

const parsed = await parseSkillFrontmatter("---\nname: review\ndescription: Review code\n---\n");
validateSkillFileMetadata(parsed.frontmatter, "review");
```

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildSkillManifestPrompt` | Build a bounded, injection-safe skill manifest for an agent system prompt. Catalog IDs and descriptions are JSON-quoted and explicitly labeled as untrusted metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/prompt-augmentation.ts#L133) |
| `buildUnsafeLegacySkillManifestPrompt` | **Deprecated:** This helper does not encode untrusted skill metadata and must not be used in system prompts. Use `buildSkillManifestPrompt`. Reproduce the historical raw Markdown manifest format. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/prompt-augmentation.ts#L31) |
| `createExecuteSkillScriptTool` | Create the execute_skill_script tool. Executes a script from a skill's scripts/ directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/tools.ts#L488) |
| `createLoadSkillReferenceTool` | Create the load_skill_reference tool. Reads a reference file from a skill's references/, resources/, or assets/ directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/tools.ts#L425) |
| `createLoadSkillTool` | Create the load_skill tool. Loads a skill's full instructions, available references, and scripts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/tools.ts#L345) |
| `filterToolsForSkill` | Layer 1: Filter tool definitions before sending to model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/allowed-tools.ts#L85) |
| `getAllSkills` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L272) |
| `getSkill` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L268) |
| `getSkillScriptExecutor` | Get the appropriate script executor. Checks cloud auth availability on every call so request-scoped credentials and environment overrides are respected. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/executor.ts#L968) |
| `isSkillVisibleTo` | Whether a skill is visible to the caller identified by the scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L53) |
| `isToolAllowedBySkill` | Layer 2: Check if a specific tool call is allowed at execution time. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/allowed-tools.ts#L118) |
| `listSkillSubdir` | List files in a skill subdirectory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/path-safety.ts#L507) |
| `listStrictSkillSubdir` | List skill files with runtime filesystem resource ceilings and deterministic order. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/path-safety.ts#L566) |
| `parseSkillFileFrontmatter` | Parse and bound an untrusted SKILL.md document read from a filesystem boundary. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L59) |
| `parseSkillFrontmatter` | Parse SKILL.md content through the bounded, fail-closed format. Malformed YAML, invalid Unicode, and oversized documents are rejected. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L36) |
| `parseUnsafeLegacySkillFrontmatter` | **Deprecated:** This parser can reinterpret malformed YAML. Use `parseSkillFrontmatter` or `parseSkillFileFrontmatter`. Parse using the historical unbounded, lossy YAML fallback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L46) |
| `readBoundedSkillTextFile` | Read one skill-owned text file through a fixed byte budget. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/bounded-text-file.ts#L612) |
| `registerSkill` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L264) |
| `validateAllowedToolPatterns` | Validate allowed-tool patterns at parse time. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/allowed-tools.ts#L150) |
| `validateSkillFileMetadata` | Validate metadata loaded from a filesystem skill. The caller-supplied directory/runtime identity remains canonical; a differing authored `name` is display metadata and never participates in lookup or authorization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L321) |
| `validateSkillMetadata` | Validate and normalize parsed frontmatter into SkillMetadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L148) |
| `validateSkillPath` | Validate that a requested path is safe within a skill's root directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/path-safety.ts#L317) |
| `validateStrictSkillPath` | Validate a skill path with runtime filesystem resource ceilings. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/path-safety.ts#L407) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ActiveSkillContext` | Active skill context for runtime policy tracking | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L180) |
| `AgentCapabilityScope` | Caller scope used for owner-aware capability resolution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L47) |
| `Skill` | Registered skill instance | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L116) |
| `SkillContent` | Full skill content returned by load_skill tool | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L102) |
| `SkillMetadata` | Parsed frontmatter metadata from SKILL.md | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L84) |
| `SkillScriptExecutor` | Script executor interface | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L175) |
| `SkillScriptExecutorInput` | Input for the script executor | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L143) |
| `SkillScriptResult` | Result from executing a skill script | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L136) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `SKILL_ALLOWED_TOOL_PATTERN_REGEX` | Valid allowed-tool pattern: exact ID or prefix wildcard (e.g. "api:*") | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L28) |
| `SKILL_ASSETS_DIR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L71) |
| `SKILL_DESCRIPTION_MAX_LENGTH` | Maximum description length in characters | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L32) |
| `SKILL_MD_FILENAME` | Standard SKILL.md filename per agentskills.io spec | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L44) |
| `SKILL_NAME_REGEX` | Historical public skill-name matcher. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L16) |
| `SKILL_READABLE_DIRS` | Canonical read-only skill directories exposed through reference loading. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L73) |
| `SKILL_REFERENCES_DIR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L69) |
| `SKILL_RELATIVE_PATH_MAX_LENGTH` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/limits.ts#L10) |
| `SKILL_RESOURCES_DIR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L70) |
| `SKILL_SCRIPTS_DIR` | Conventional subdirectory names | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L68) |
| `SKILL_STRICT_NAME_REGEX` | Strict filesystem skill-name matcher: 1-64 lowercase alphanumeric characters or single hyphens, without leading or trailing hyphens. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L22) |
| `SKILL_SUBDIR_MAX_ENTRIES` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/limits.ts#L17) |
| `SKILL_TEXT_FILE_MAX_BYTES` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/limits.ts#L12) |
| `SKILL_TOOL_IDS` | Public snapshot of tool IDs that belong to the skill system. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L60) |
| `skillRegistry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L262) |
