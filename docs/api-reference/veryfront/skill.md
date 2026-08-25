---
title: "veryfront/skill"
description: "Agent skills. Public API for the agent skills system. Skills are project-level capabilities defined as SKILL.md files following the agentskills.io specification."
order: 36
---

## Import

```ts
import {
  createExecuteSkillScriptTool,
  createLoadSkillReferenceTool,
  createLoadSkillTool,
  filterToolNamesForSkill,
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

| Name                               | Description                                                                                                                                  | Source                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `SKILL_ALLOWED_TOOL_PATTERN_REGEX` | Public inspection matcher for exact tool IDs and prefix wildcards. Mutating this compatibility value does not alter authorization decisions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L108) |
| `SKILL_ASSETS_DIR`                 |                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L159) |
| `SKILL_DESCRIPTION_MAX_LENGTH`     | Maximum description length in characters                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L119) |
| `SKILL_MD_FILENAME`                | Standard SKILL.md filename per agentskills.io spec                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L131) |
| `SKILL_METADATA_KEY_MAX_LENGTH`    |                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L127) |
| `SKILL_METADATA_MAX_ENTRIES`       |                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L126) |
| `SKILL_METADATA_VALUE_MAX_LENGTH`  |                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L128) |
| `SKILL_NAME_REGEX`                 | Historical public skill-name inspection matcher. Mutating this compatibility value does not alter framework admission.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L35)  |
| `SKILL_READABLE_DIRS`              | Canonical read-only skill directories exposed through reference loading.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L161) |
| `SKILL_REFERENCES_DIR`             |                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L157) |
| `SKILL_RESOURCES_DIR`              |                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L158) |
| `SKILL_SCRIPTS_DIR`                | Conventional subdirectory names                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L156) |
| `SKILL_TOOL_IDS`                   | Public snapshot of tool IDs that belong to the skill system.                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L148) |

### Functions

| Name                           | Description                                                                                                                                                                                                                                                                            | Source                                                                                            |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `createExecuteSkillScriptTool` | Create the execute_skill_script tool. Executes a script from a skill's scripts/ directory.                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/tools.ts#L598)           |
| `createLoadSkillReferenceTool` | Create the load_skill_reference tool. Reads a reference file from a skill's references/, resources/, or assets/ directory.                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/tools.ts#L554)           |
| `createLoadSkillTool`          | Create the load_skill tool. Loads a skill's full instructions, available references, and scripts.                                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/tools.ts#L484)           |
| `filterToolNamesForSkill`      | Filter provider-native or other name-only tool inventories through the same boundary.                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/allowed-tools.ts#L86)    |
| `filterToolsForSkill`          | Filter tool definitions before sending them to the model.                                                                                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/allowed-tools.ts#L64)    |
| `getAllSkills`                 |                                                                                                                                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L277)        |
| `getSkill`                     |                                                                                                                                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L273)        |
| `getSkillScriptExecutor`       | Get the appropriate script executor. Checks cloud auth availability on every call so request-scoped credentials and environment overrides are respected.                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/executor.ts#L473)        |
| `isSkillInfrastructureToolId`  | Framework-owned membership check that cannot be changed by public Set mutation.                                                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L151)           |
| `isSkillToolAvailable`         | Check whether a specific tool call is available at execution time.                                                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/allowed-tools.ts#L78)    |
| `isSkillVisibleTo`             | Whether a skill is visible to the caller identified by the scope.                                                                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L65)         |
| `isValidProviderSafeSkillId`   | Framework-owned provider-safe owned skill-id grammar check.                                                                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L67)            |
| `isValidSkillName`             | Framework-owned historical skill-name grammar check.                                                                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L55)            |
| `isValidStrictSkillName`       | Framework-owned strict filesystem skill-name grammar check.                                                                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L61)            |
| `listSkillSubdir`              | List files with the public compatibility resource policy. Enumeration is not entry-capped and preserves the filesystem adapter's iteration order. `listStrictSkillSubdir` applies the runtime filesystem ceilings and deterministic ordering.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/path-safety.ts#L666)     |
| `parseBoundedSkillDocument`    | Parse one bounded Skill document with an explicit provider or the active extension contract generation.                                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/document-parser.ts#L361) |
| `parseSkillFileFrontmatter`    | Parse and bound an untrusted SKILL.md document read from a filesystem boundary. YAML frontmatter is decoded by the explicit provider, or by the active `SkillDocumentParserProvider` registration when the argument is omitted.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L108)          |
| `parseSkillFrontmatter`        | Parse SKILL.md content through the bounded, fail-closed format. Malformed YAML, invalid Unicode, and oversized documents are rejected. YAML frontmatter is decoded by the explicit provider, or by the active `SkillDocumentParserProvider` registration when the argument is omitted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L94)           |
| `registerSkill`                |                                                                                                                                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L269)        |
| `validateSkillFileMetadata`    | Validate metadata loaded from a filesystem skill. The caller-supplied directory/runtime identity remains canonical; a differing authored `name` is display metadata and never participates in lookup or authorization.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L457)          |
| `validateSkillMetadata`        | Validate and normalize parsed frontmatter into SkillMetadata.                                                                                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L194)          |
| `validateSkillPath`            | Validate a requested path with the public compatibility resource policy. Relative paths may contain up to 4096 characters and filesystem directory enumeration is not entry-capped. `validateStrictSkillPath` applies the runtime filesystem ceilings.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/path-safety.ts#L535)     |

### Types

| Name                       | Description                                                              | Source                                                                                           |
| -------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `ActiveSkillContext`       | Active skill context for runtime availability and delegation tracking    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L310)          |
| `AgentCapabilityScope`     | Caller scope used for owner-aware capability resolution.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L59)        |
| `ParsedSkillContent`       | Result of splitting and decoding one bounded `SKILL.md` document.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/document-parser.ts#L48) |
| `Skill`                    | Registered skill instance                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L203)          |
| `SkillContent`             | Full skill content returned by load_skill tool                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L190)          |
| `SkillMetadata`            | Parsed frontmatter metadata from SKILL.md                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L172)          |
| `SkillScriptExecutor`      | Script executor interface.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L305)          |
| `SkillScriptExecutorInput` | Input for the script executor                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L259)          |
| `SkillScriptResult`        | Result from executing a skill script.                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L231)          |
| `SkillScriptSnapshot`      | Bounded, validated script tree used to preserve same-directory imports.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L251)          |
| `SkillScriptSnapshotFile`  | One validated text file retained in an executable skill-script snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L238)          |

### Constants

| Name            | Description | Source                                                                                     |
| --------------- | ----------- | ------------------------------------------------------------------------------------------ |
| `skillRegistry` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L267) |
