---
title: "veryfront/skill"
description: "Agent skills. Public API for the agent skills system. Skills are project-level capabilities defined as SKILL.md files using the Agent Skills metadata format and Veryfront's documented, fail-closed allowed-tools subset. YAML decoding is supplied by the `SkillDocumentParserProvider` extension contract. The CLI composes `@veryfront/ext-yaml` automatically; standalone parser calls pass a provider explicitly or use an active registration."
order: 34
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
import { createStdYamlSkillDocumentParserProvider } from "@veryfront/ext-yaml";

const parser = createStdYamlSkillDocumentParserProvider();
const parsed = await parseSkillFrontmatter(
  "---\nname: review\ndescription: Review code\n---\n",
  parser,
);
validateSkillFileMetadata(parsed.frontmatter, "review");
```

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `buildSkillManifestPrompt` | Build a bounded, injection-safe skill manifest for an agent system prompt. Catalog IDs and descriptions are JSON-quoted and explicitly labeled as untrusted metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/prompt-augmentation.ts#L247) |
| `buildUnsafeLegacySkillManifestPrompt` | **Deprecated:** This helper does not encode untrusted skill metadata and must not be used in system prompts. Use `buildSkillManifestPrompt`. Reproduce the historical raw Markdown manifest format. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/prompt-augmentation.ts#L131) |
| `createExecuteSkillScriptTool` | Create the execute_skill_script tool. Executes a script from a skill's scripts/ directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/tools.ts#L581) |
| `createLoadSkillReferenceTool` | Create the load_skill_reference tool. Reads a reference file from a skill's references/, resources/, or assets/ directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/tools.ts#L517) |
| `createLoadSkillTool` | Create the load_skill tool. Loads a skill's full instructions, available references, and scripts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/tools.ts#L436) |
| `filterToolsForSkill` | Layer 1: Filter tool definitions before sending to model. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/allowed-tools.ts#L118) |
| `getAllSkills` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L283) |
| `getSkill` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L279) |
| `getSkillScriptExecutor` | Get the appropriate script executor. Checks cloud auth availability on every call so request-scoped credentials and environment overrides are respected. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/executor.ts#L757) |
| `isSkillVisibleTo` | Whether a skill is visible to the caller identified by the scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L64) |
| `isToolAllowedBySkill` | Layer 2: Check if a specific tool call is allowed at execution time. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/allowed-tools.ts#L153) |
| `isValidProviderSafeSkillId` | Framework-owned provider-safe owned skill-id grammar check. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L66) |
| `isValidSkillName` | Framework-owned historical skill-name grammar check. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L54) |
| `isValidStrictSkillName` | Framework-owned strict filesystem skill-name grammar check. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L60) |
| `listSkillSubdir` | List files with the public compatibility resource policy. Enumeration is not entry-capped and preserves the filesystem adapter's iteration order. `listStrictSkillSubdir` applies the runtime filesystem ceilings and deterministic ordering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/path-safety.ts#L626) |
| `listStrictSkillSubdir` | List at most 1000 skill directory entries in deterministic filename order. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/path-safety.ts#L643) |
| `parseSkillFileFrontmatter` | Parse and bound an untrusted SKILL.md document read from a filesystem boundary. YAML frontmatter is decoded by the explicit provider, or by the active `SkillDocumentParserProvider` registration when the argument is omitted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L136) |
| `parseSkillFrontmatter` | Parse SKILL.md content through the bounded, fail-closed format. Malformed YAML, invalid Unicode, and oversized documents are rejected. YAML frontmatter is decoded by the explicit provider, or by the active `SkillDocumentParserProvider` registration when the argument is omitted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L104) |
| `parseUnsafeLegacySkillFrontmatter` | **Deprecated:** This parser can reinterpret malformed YAML. Use `parseSkillFrontmatter` or `parseSkillFileFrontmatter`. Parse using the historical unbounded YAML contract, retaining its lossy line-oriented fallback only when the decoder is unavailable or rejects the input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L119) |
| `readBoundedSkillTextFile` | Read one skill-owned text file through a fixed byte budget. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/bounded-text-file.ts#L702) |
| `registerSkill` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L275) |
| `snapshotSkillScriptResult` | Validate, output-bound, detach, and freeze an executor-provided result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/script-result.ts#L70) |
| `validateAllowedToolPatterns` | Validate allowed-tool patterns at parse time. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/allowed-tools.ts#L199) |
| `validateSkillFileMetadata` | Validate metadata loaded from a filesystem skill. The caller-supplied directory/runtime identity remains canonical; a differing authored `name` is display metadata and never participates in lookup or authorization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L484) |
| `validateSkillMetadata` | Validate and normalize parsed frontmatter into SkillMetadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/parser.ts#L221) |
| `validateSkillPath` | Validate a requested path with the public compatibility resource policy. Relative paths may contain up to 4096 characters and filesystem directory enumeration is not entry-capped. `validateStrictSkillPath` applies the runtime filesystem ceilings. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/path-safety.ts#L472) |
| `validateStrictSkillPath` | Validate a skill path with runtime filesystem resource ceilings. Relative paths are limited to 1024 characters and each inspected directory is limited to 1000 entries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/path-safety.ts#L494) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ActiveSkillContext` | Active skill context for runtime policy tracking | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L254) |
| `AgentCapabilityScope` | Caller scope used for owner-aware capability resolution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L58) |
| `Skill` | Registered skill instance | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L177) |
| `SkillContent` | Full skill content returned by load_skill tool | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L163) |
| `SkillMetadata` | Parsed frontmatter metadata from SKILL.md | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L145) |
| `SkillScriptExecutor` | Script executor interface. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L249) |
| `SkillScriptExecutorInput` | Input for the script executor | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L212) |
| `SkillScriptResult` | Result from executing a skill script. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L205) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `SKILL_ALLOWED_TOOL_PATTERN_REGEX` | Public inspection matcher for exact tool IDs and prefix wildcards. Mutating this compatibility value does not alter authorization decisions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L81) |
| `SKILL_ASSETS_DIR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L132) |
| `SKILL_DESCRIPTION_MAX_LENGTH` | Maximum description length in characters | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L92) |
| `SKILL_MD_FILENAME` | Standard SKILL.md filename per agentskills.io spec | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L104) |
| `SKILL_NAME_REGEX` | Historical public skill-name inspection matcher. Mutating this compatibility value does not alter framework admission. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L34) |
| `SKILL_READABLE_DIRS` | Canonical read-only skill directories exposed through reference loading. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L134) |
| `SKILL_REFERENCES_DIR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L130) |
| `SKILL_RELATIVE_PATH_MAX_LENGTH` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/limits.ts#L14) |
| `SKILL_RESOURCES_DIR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L131) |
| `SKILL_SCRIPT_MAX_OUTPUT_BYTES` | Combined UTF-8 byte ceiling for stdout and stderr returned by a skill tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/limits.ts#L39) |
| `SKILL_SCRIPTS_DIR` | Conventional subdirectory names | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L129) |
| `SKILL_STRICT_NAME_REGEX` | Strict filesystem skill-name matcher: 1-64 lowercase alphanumeric characters or single hyphens, without leading or trailing hyphens. Mutating this compatibility value does not alter framework admission. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L41) |
| `SKILL_SUBDIR_MAX_ENTRIES` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/limits.ts#L21) |
| `SKILL_TEXT_FILE_MAX_BYTES` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/limits.ts#L16) |
| `SKILL_TOOL_IDS` | Public snapshot of tool IDs that belong to the skill system. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/types.ts#L121) |
| `skillRegistry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/skill/registry.ts#L273) |
