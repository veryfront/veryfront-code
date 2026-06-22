---
title: "veryfront/skill"
description: "Agent skills. Public API for the agent skills system. Skills are project-level capabilities defined as SKILL.md files following the agentskills.io specification."
order: 28
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
| `SKILL_ALLOWED_TOOL_PATTERN_REGEX` | Valid allowed-tool pattern: exact ID or prefix wildcard (e.g. "api:*") | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L17) |
| `SKILL_ASSETS_DIR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L37) |
| `SKILL_DESCRIPTION_MAX_LENGTH` | Maximum description length in characters | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L21) |
| `SKILL_MD_FILENAME` | Standard SKILL.md filename per agentskills.io spec | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L24) |
| `SKILL_NAME_REGEX` | Valid skill name: lowercase alphanumeric + hyphens, 1-64 chars | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L14) |
| `SKILL_REFERENCES_DIR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L35) |
| `SKILL_RESOURCES_DIR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L36) |
| `SKILL_SCRIPTS_DIR` | Conventional subdirectory names | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L34) |
| `SKILL_TOOL_IDS` | Tool IDs that belong to the skill system (single source of truth) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L27) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildSkillManifestPrompt` | Build the skill manifest prompt section for an agent's system prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/prompt-augmentation.ts#L19) |
| `createExecuteSkillScriptTool` | Create the execute_skill_script tool. Executes a script from a skill's scripts/ directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/tools.ts#L200) |
| `createLoadSkillReferenceTool` | Create the load_skill_reference tool. Reads a reference file from a skill's references/, resources/, or assets/ directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/tools.ts#L173) |
| `createLoadSkillTool` | Create the load_skill tool. Loads a skill's full instructions, available references, and scripts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/tools.ts#L121) |
| `filterToolsForSkill` | Layer 1: Filter tool definitions before sending to model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/allowed-tools.ts#L46) |
| `getAllSkills` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L111) |
| `getSkill` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L107) |
| `getSkillScriptExecutor` | Get the appropriate script executor. Checks cloud auth availability on every call so request-scoped credentials and environment overrides are respected. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/executor.ts#L211) |
| `isSkillVisibleTo` | Whether a skill is visible to the caller identified by the scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L27) |
| `isToolAllowedBySkill` | Layer 2: Check if a specific tool call is allowed at execution time. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/allowed-tools.ts#L67) |
| `listSkillSubdir` | List files in a skill subdirectory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/path-safety.ts#L187) |
| `parseSkillFrontmatter` | Parse SKILL.md content into frontmatter + body. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L26) |
| `registerSkill` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L103) |
| `validateAllowedToolPatterns` | Validate allowed-tool patterns at parse time. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/allowed-tools.ts#L86) |
| `validateSkillMetadata` | Validate and normalize parsed frontmatter into SkillMetadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L75) |
| `validateSkillPath` | Validate that a requested path is safe within a skill's root directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/path-safety.ts#L105) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ActiveSkillContext` | Active skill context for runtime policy tracking | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L112) |
| `AgentCapabilityScope` | Caller scope used for owner-aware capability resolution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L21) |
| `Skill` | Registered skill instance | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L70) |
| `SkillContent` | Full skill content returned by load_skill tool | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L58) |
| `SkillMetadata` | Parsed frontmatter metadata from SKILL.md | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L42) |
| `SkillScriptExecutor` | Script executor interface | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L107) |
| `SkillScriptExecutorInput` | Input for the script executor | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L97) |
| `SkillScriptResult` | Result from executing a skill script | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L90) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `skillRegistry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L101) |
