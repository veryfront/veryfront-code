---
title: "veryfront/skill"
description: "Agent skills. Public API for the agent skills system. Skills are project-level capabilities defined as SKILL.md files using the Agent Skills metadata format and Veryfront's documented, fail-closed allowed-tools subset."
order: 32
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

| Name                               | Description                                                                                                                          | Source                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `SKILL_ALLOWED_TOOL_PATTERN_REGEX` | Valid allowed-tool pattern: exact ID or prefix wildcard (e.g. "api:*")                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L25)  |
| `SKILL_ASSETS_DIR`                 |                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L68)  |
| `SKILL_DESCRIPTION_MAX_LENGTH`     | Maximum description length in characters                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L29)  |
| `SKILL_MD_FILENAME`                | Standard SKILL.md filename per agentskills.io spec                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L41)  |
| `SKILL_NAME_REGEX`                 | Historical public skill-name matcher.                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L16)  |
| `SKILL_READABLE_DIRS`              | Canonical read-only skill directories exposed through reference loading.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L70)  |
| `SKILL_REFERENCES_DIR`             |                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L66)  |
| `SKILL_RELATIVE_PATH_MAX_LENGTH`   |                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/limits.ts#L10) |
| `SKILL_RESOURCES_DIR`              |                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L67)  |
| `SKILL_SCRIPTS_DIR`                | Conventional subdirectory names                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L65)  |
| `SKILL_STRICT_NAME_REGEX`          | Strict filesystem skill-name matcher: 1-64 lowercase alphanumeric characters or single hyphens, without leading or trailing hyphens. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L22)  |
| `SKILL_SUBDIR_MAX_ENTRIES`         |                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/limits.ts#L17) |
| `SKILL_TEXT_FILE_MAX_BYTES`        |                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/limits.ts#L12) |
| `SKILL_TOOL_IDS`                   | Public snapshot of tool IDs that belong to the skill system.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L57)  |

### Functions

| Name                           | Description                                                                                                                                                                                                                                                        | Source                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `buildSkillManifestPrompt`     | Build the skill manifest prompt section for an agent's system prompt.                                                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/prompt-augmentation.ts#L34) |
| `createExecuteSkillScriptTool` | Create the execute_skill_script tool. Executes a script from a skill's scripts/ directory.                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/tools.ts#L324)              |
| `createLoadSkillReferenceTool` | Create the load_skill_reference tool. Reads a reference file from a skill's references/, resources/, or assets/ directory.                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/tools.ts#L287)              |
| `createLoadSkillTool`          | Create the load_skill tool. Loads a skill's full instructions, available references, and scripts.                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/tools.ts#L222)              |
| `filterToolsForSkill`          | Layer 1: Filter tool definitions before sending to model.                                                                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/allowed-tools.ts#L85)       |
| `getAllSkills`                 |                                                                                                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L242)           |
| `getSkill`                     |                                                                                                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L238)           |
| `getSkillScriptExecutor`       | Get the appropriate script executor. Checks cloud auth availability on every call so request-scoped credentials and environment overrides are respected.                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/executor.ts#L958)           |
| `isSkillVisibleTo`             | Whether a skill is visible to the caller identified by the scope.                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L48)            |
| `isToolAllowedBySkill`         | Layer 2: Check if a specific tool call is allowed at execution time.                                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/allowed-tools.ts#L118)      |
| `listSkillSubdir`              | List files in a skill subdirectory.                                                                                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/path-safety.ts#L491)        |
| `listStrictSkillSubdir`        | List skill files with runtime filesystem resource ceilings and deterministic order.                                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/path-safety.ts#L550)        |
| `parseSkillFileFrontmatter`    | Parse and bound an untrusted SKILL.md document read from a filesystem boundary.                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L45)              |
| `parseSkillFrontmatter`        | Parse SKILL.md content into frontmatter + body.                                                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L34)              |
| `readBoundedSkillTextFile`     | Read one skill-owned text file through a fixed byte budget.                                                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/bounded-text-file.ts#L605)  |
| `registerSkill`                |                                                                                                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L234)           |
| `validateAllowedToolPatterns`  | Validate allowed-tool patterns at parse time.                                                                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/allowed-tools.ts#L150)      |
| `validateSkillFileMetadata`    | Validate metadata loaded from a filesystem skill. The public normalizer keeps its historical directory-name fallback for programmatic callers, while file discovery follows the Agent Skills requirement that `name` is declared and matches the parent directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L275)             |
| `validateSkillMetadata`        | Validate and normalize parsed frontmatter into SkillMetadata.                                                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L134)             |
| `validateSkillPath`            | Validate that a requested path is safe within a skill's root directory.                                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/path-safety.ts#L312)        |
| `validateStrictSkillPath`      | Validate a skill path with runtime filesystem resource ceilings.                                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/path-safety.ts#L402)        |

### Types

| Name                       | Description                                              | Source                                                                                    |
| -------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `ActiveSkillContext`       | Active skill context for runtime policy tracking         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L175)   |
| `AgentCapabilityScope`     | Caller scope used for owner-aware capability resolution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L42) |
| `Skill`                    | Registered skill instance                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L111)   |
| `SkillContent`             | Full skill content returned by load_skill tool           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L97)    |
| `SkillMetadata`            | Parsed frontmatter metadata from SKILL.md                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L81)    |
| `SkillScriptExecutor`      | Script executor interface                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L170)   |
| `SkillScriptExecutorInput` | Input for the script executor                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L138)   |
| `SkillScriptResult`        | Result from executing a skill script                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L131)   |

### Constants

| Name            | Description | Source                                                                                     |
| --------------- | ----------- | ------------------------------------------------------------------------------------------ |
| `skillRegistry` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L232) |
