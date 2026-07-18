---
title: "veryfront/skill"
description: "Agent skills. Public API for the agent skills system. Skills are project-level capabilities defined as SKILL.md files following the agentskills.io specification."
order: 30
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
| `SKILL_ALLOWED_TOOL_PATTERN_REGEX` | Valid allowed-tool pattern: exact ID or prefix wildcard (e.g. "api:*") | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L18) |
| `SKILL_ASSETS_DIR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L38) |
| `SKILL_DESCRIPTION_MAX_LENGTH` | Maximum description length in characters | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L22) |
| `SKILL_MD_FILENAME` | Standard SKILL.md filename per agentskills.io spec | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L25) |
| `SKILL_NAME_REGEX` | Valid skill name: lowercase alphanumeric + hyphens, 1-64 chars | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L15) |
| `SKILL_REFERENCES_DIR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L36) |
| `SKILL_RESOURCES_DIR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L37) |
| `SKILL_SCRIPTS_DIR` | Conventional subdirectory names | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L35) |
| `SKILL_TOOL_IDS` | Tool IDs that belong to the skill system (single source of truth) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L28) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildSkillManifestPrompt` | Build the skill manifest prompt section for an agent's system prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/prompt-augmentation.ts#L20) |
| `createExecuteSkillScriptTool` | Create the execute_skill_script tool. Executes a script from a skill's scripts/ directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/tools.ts#L258) |
| `createLoadSkillReferenceTool` | Create the load_skill_reference tool. Reads a reference file from a skill's references/, resources/, or assets/ directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/tools.ts#L221) |
| `createLoadSkillTool` | Create the load_skill tool. Loads a skill's full instructions, available references, and scripts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/tools.ts#L165) |
| `filterToolsForSkill` | Layer 1: Filter tool definitions before sending to model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/allowed-tools.ts#L81) |
| `getAllSkills` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L112) |
| `getSkill` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L108) |
| `getSkillScriptExecutor` | Get the appropriate script executor. Checks cloud auth availability on every call so request-scoped credentials and environment overrides are respected. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/executor.ts#L215) |
| `isSkillVisibleTo` | Whether a skill is visible to the caller identified by the scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L28) |
| `isToolAllowedBySkill` | Layer 2: Check if a specific tool call is allowed at execution time. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/allowed-tools.ts#L114) |
| `listSkillSubdir` | List files in a skill subdirectory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/path-safety.ts#L197) |
| `parseSkillFrontmatter` | Parse SKILL.md content into frontmatter + body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L27) |
| `registerSkill` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L104) |
| `validateAllowedToolPatterns` | Validate allowed-tool patterns at parse time. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/allowed-tools.ts#L135) |
| `validateSkillMetadata` | Validate and normalize parsed frontmatter into SkillMetadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L76) |
| `validateSkillPath` | Validate that a requested path is safe within a skill's root directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/path-safety.ts#L115) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ActiveSkillContext` | Active skill context for runtime policy tracking | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L115) |
| `AgentCapabilityScope` | Caller scope used for owner-aware capability resolution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L22) |
| `Skill` | Registered skill instance | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L73) |
| `SkillContent` | Full skill content returned by load_skill tool | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L59) |
| `SkillMetadata` | Parsed frontmatter metadata from SKILL.md | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L43) |
| `SkillScriptExecutor` | Script executor interface | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L110) |
| `SkillScriptExecutorInput` | Input for the script executor | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L100) |
| `SkillScriptResult` | Result from executing a skill script | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L93) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `skillRegistry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L102) |
