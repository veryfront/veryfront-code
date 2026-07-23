---
title: "veryfront/skill"
description: "Agent skills. Public API for the agent skills system. Skills are project-level capabilities defined as SKILL.md files following the agentskills.io specification."
order: 31
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
import { parseSkillFrontmatter, validateSkillMetadata } from "veryfront/skill";

const parsed = await parseSkillFrontmatter("---\nname: review\ndescription: Review code\n---\n");
validateSkillMetadata(parsed.frontmatter, "review");
```

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `SKILL_ALLOWED_TOOL_PATTERN_REGEX` | Valid allowed-tool pattern: exact ID or prefix wildcard (e.g. "api:*") | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L19) |
| `SKILL_ASSETS_DIR` | Conventional directory for static skill assets. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L137) |
| `SKILL_COMPATIBILITY_MAX_LENGTH` | Maximum compatibility field length in characters. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L26) |
| `SKILL_DEFINITION_MAX_BYTES` | Maximum UTF-8 size of one SKILL.md definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L29) |
| `SKILL_DESCRIPTION_MAX_LENGTH` | Maximum description length in characters | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L23) |
| `SKILL_MD_FILENAME` | Standard SKILL.md filename per agentskills.io spec | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L32) |
| `SKILL_NAME_REGEX` | Valid skill name: lowercase alphanumeric segments separated by single hyphens, 1-64 chars. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L16) |
| `SKILL_REFERENCES_DIR` | Conventional directory for skill reference documents. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L131) |
| `SKILL_RESOURCES_DIR` | Veryfront extension directory for loadable skill resources. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L134) |
| `SKILL_SCRIPTS_DIR` | Conventional directory for executable skill scripts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L128) |
| `SKILL_TOOL_IDS` | Immutable tool IDs that belong to the skill system. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L123) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildSkillManifestPrompt` | Build the skill manifest prompt section for an agent's system prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/prompt-augmentation.ts#L41) |
| `createExecuteSkillScriptTool` | Create the execute_skill_script tool. Executes a script from a skill's scripts/ directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/tools.ts#L488) |
| `createLoadSkillReferenceTool` | Create the load_skill_reference tool. Reads a reference file from a skill's references/, resources/, or assets/ directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/tools.ts#L445) |
| `createLoadSkillTool` | Create the load_skill tool. Loads a skill's full instructions, available references, and scripts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/tools.ts#L373) |
| `filterToolsForSkill` | Layer 1: Filter tool definitions before sending to model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/allowed-tools.ts#L87) |
| `getAllSkills` | Return detached copies of skills visible in the current project scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L390) |
| `getSkill` | Get a detached copy of one skill visible in the current project scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L385) |
| `getSkillScriptExecutor` | Get the appropriate script executor. Checks cloud auth availability on every call so request-scoped credentials and environment overrides are respected. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/executor.ts#L714) |
| `isSkillVisibleTo` | Whether a skill is visible to the caller identified by the scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L244) |
| `isToolAllowedBySkill` | Layer 2: Check if a specific tool call is allowed at execution time. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/allowed-tools.ts#L120) |
| `listSkillSubdir` | List files in a skill subdirectory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/path-safety.ts#L394) |
| `parseSkillFrontmatter` | Parse SKILL.md content into frontmatter + body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L97) |
| `registerSkill` | Register a skill in the current project scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L380) |
| `validateAllowedToolPatterns` | Validate allowed-tool patterns at parse time. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/allowed-tools.ts#L141) |
| `validateSkillMetadata` | Validate and normalize parsed frontmatter into SkillMetadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L131) |
| `validateSkillPath` | Validate that a requested path is safe within a skill's root directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/path-safety.ts#L323) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ActiveSkillContext` | Active skill context for runtime policy tracking | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L226) |
| `AgentCapabilityScope` | Caller scope used for owner-aware capability resolution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L238) |
| `ParsedSkillContent` | Result of parsing a SKILL.md file | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L21) |
| `Skill` | Registered skill instance | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L172) |
| `SkillContent` | Full skill content returned by load_skill tool | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L158) |
| `SkillMetadata` | Parsed frontmatter metadata from SKILL.md | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L142) |
| `SkillScriptExecutor` | Script executor interface | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L220) |
| `SkillScriptExecutorInput` | Input for the script executor | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L202) |
| `SkillScriptResult` | Result from executing a skill script | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L192) |
| `SkillToolAvailability` | Active skill file-backed capabilities available to skill infrastructure tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/allowed-tools.ts#L15) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `skillRegistry` | Project-scoped registry for discovered and manually registered skills. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L377) |
