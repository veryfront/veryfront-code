# NLSpec: src/skill/

## Purpose

The skill module implements the agent skills system following the agentskills.io specification. Skills are project-level capabilities defined as `SKILL.md` files with YAML frontmatter. The module provides: discovery and registration of skills in a project-scoped registry, parsing and validation of SKILL.md frontmatter, three agent-facing tools (`load-skill`, `load-skill-reference`, `execute-skill-script`), path-safety enforcement to prevent traversal/symlink attacks, allowed-tool policy enforcement (dual-layer: planning-time filtering and execution-time gating), cross-runtime script execution (local subprocess or cloud sandbox), and prompt augmentation to inject a skill manifest into agent system prompts.

## Public API

### Exports

| Export | Type | Description |
|--------|------|-------------|
| `Skill` | interface | Registered skill instance (id, metadata, rootPath, fsAdapter?) |
| `SkillMetadata` | interface | Parsed frontmatter (name, description, allowedTools?, license?, etc.) |
| `SkillContent` | interface | Full skill content returned by load-skill tool |
| `SkillScriptResult` | interface | Script execution result (stdout, stderr, exitCode) |
| `SkillScriptExecutor` | interface | Script executor contract |
| `SkillScriptExecutorInput` | interface | Input for script execution |
| `ActiveSkillContext` | interface | Runtime context tracking active skill and its tool policy |
| `SKILL_NAME_REGEX` | RegExp | Valid skill name pattern: lowercase alphanumeric + hyphens, 1-64 chars |
| `SKILL_ALLOWED_TOOL_PATTERN_REGEX` | RegExp | Valid tool pattern: exact ID or prefix wildcard |
| `SKILL_DESCRIPTION_MAX_LENGTH` | number | Max description length (1024) |
| `SKILL_MD_FILENAME` | string | Standard filename: "SKILL.md" |
| `SKILL_TOOL_IDS` | Set\<string\> | Tool IDs belonging to the skill system |
| `SKILL_SCRIPTS_DIR` | string | "scripts" subdirectory name |
| `SKILL_REFERENCES_DIR` | string | "references" subdirectory name |
| `SKILL_ASSETS_DIR` | string | "assets" subdirectory name |
| `skillRegistry` | SkillRegistryClass | Project-scoped registry with resolveForAgent() |
| `registerSkill(id, skill)` | function | Register a skill in the current project scope |
| `getSkill(id)` | function | Retrieve a skill by ID |
| `getAllSkills()` | function | Get all registered skills as a Map |
| `parseSkillFrontmatter(content)` | async function | Parse SKILL.md into frontmatter + body |
| `validateSkillMetadata(fm, dirName)` | function | Validate and normalize frontmatter into SkillMetadata |
| `validateSkillPath(root, path, subdirs, adapter?)` | async function | Validate a file path is safe within a skill directory |
| `listSkillSubdir(root, subdir, adapter?)` | async function | List files in a skill subdirectory |
| `createLoadSkillTool()` | function | Create the load-skill agent tool |
| `createLoadSkillReferenceTool()` | function | Create the load-skill-reference agent tool |
| `createExecuteSkillScriptTool()` | function | Create the execute-skill-script agent tool |
| `getSkillScriptExecutor()` | function | Get LocalScriptExecutor or CloudScriptExecutor based on env |
| `buildSkillManifestPrompt(skills)` | function | Build skill manifest for agent system prompts |
| `filterToolsForSkill(tools, allowed)` | function | Layer 1: filter tool definitions at planning time |
| `isToolAllowedBySkill(name, allowed)` | function | Layer 2: check a tool call at execution time |
| `validateAllowedToolPatterns(patterns)` | function | Validate tool patterns at parse time |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `createError`, `toError` | `#veryfront/errors/veryfront-error.ts` | Structured error creation |
| `validatePath` | `#veryfront/security` | Centralized path validation |
| `z` (zod) | `zod` | Tool input schema definitions |
| `tool` | `#veryfront/tool/factory.ts` | Agent tool factory |
| `readTextFile`, `exists`, `readDir`, `stat`, etc. | `#veryfront/platform/compat/fs.ts` | Cross-runtime filesystem ops |
| `join`, `relative`, `resolve`, `isAbsolute`, `extname` | `#veryfront/compat/path` | Cross-runtime path utilities |
| `runCommand`, `getEnv` | `#veryfront/platform/compat/process.ts` | Subprocess execution and env access |
| `isDeno` | `#veryfront/platform/compat/runtime.ts` | Runtime detection for script executor |
| `ProjectScopedRegistryManager` | `#veryfront/ai/registry-manager.ts` | Project-scoped registry backing store |
| `ScopedRegistryFacade` | `#veryfront/ai/registry-facade.ts` | Registry facade base class |
| `FileSystemAdapter` | `#veryfront/platform/adapters/base.ts` | VFS/cloud filesystem abstraction |
| `Sandbox` | `#veryfront/sandbox` | Cloud sandbox (lazy-imported) |
| `extract` | `#std/front-matter/yaml.ts` | YAML frontmatter parsing (primary, with fallback) |

## Behaviors

### Behavior 1: Skill Registration and Lookup

- **Given**: A project with discovered skills
- **When**: `registerSkill(id, skill)` is called
- **Then**: The skill is stored in the project-scoped registry and retrievable via `getSkill(id)` or `getAllSkills()`
- **Edge cases**: Duplicate IDs overwrite silently; `getSkill` returns `undefined` for missing IDs

### Behavior 2: Resolve Skills for Agent

- **Given**: Skills registered in the registry
- **When**: `skillRegistry.resolveForAgent(config)` is called with `true`
- **Then**: Returns all registered skills
- **When**: Called with `string[]`
- **Then**: Returns only skills matching the IDs; missing IDs are silently skipped

### Behavior 3: Parse SKILL.md Frontmatter

- **Given**: A SKILL.md file content string
- **When**: `parseSkillFrontmatter(content)` is called
- **Then**: Returns `{ frontmatter, body }` using the gray-matter shim as primary parser
- **Edge cases**: Falls back to regex parser if gray-matter import fails; no frontmatter returns empty object + full content as body; empty string returns empty body

### Behavior 4: Validate Skill Metadata

- **Given**: Parsed frontmatter and a directory name
- **When**: `validateSkillMetadata(frontmatter, dirName)` is called
- **Then**: Returns normalized `SkillMetadata` with validated name, description, allowedTools, license, compatibility, metadata
- **Edge cases**: Falls back to `dirName` if no name in frontmatter; throws on invalid name (uppercase, >64 chars, invalid chars); throws on missing description; truncates description to 1024 chars; `allowed-tools` accepts space-delimited string or string array; throws on invalid patterns (fail closed); throws on non-string/non-array allowed-tools values

### Behavior 5: Load Skill Tool

- **Given**: A registered skill with SKILL.md, optional references/ and scripts/ directories
- **When**: Agent calls `load-skill` with `{ skillId }`
- **Then**: Returns skill instructions (markdown body), allowedTools policy, and lists of reference/script file paths
- **Edge cases**: Throws if skill not found (lists available skills); adds a `note` field advising against calling unavailable tools

### Behavior 6: Load Skill Reference Tool

- **Given**: A registered skill with files in references/ or assets/
- **When**: Agent calls `load-skill-reference` with `{ skillId, reference }`
- **Then**: Returns file content after path validation
- **Edge cases**: Throws if skill not found; throws if path escapes allowed subdirectories; throws if file not found; throws if path contains symlinks

### Behavior 7: Execute Skill Script Tool

- **Given**: A registered skill with files in scripts/
- **When**: Agent calls `execute-skill-script` with `{ skillId, script, args?, env?, timeoutMs? }`
- **Then**: Executes the script via LocalScriptExecutor or CloudScriptExecutor, returns `{ stdout, stderr, exitCode }`
- **Edge cases**: Path validated to scripts/ only; timeout defaults to 60s, capped at 300s; timeout returns exit code 124

### Behavior 8: Script Runtime Detection

- **Given**: A script file path
- **When**: `detectRuntime(path)` is called
- **Then**: Returns `{ command, args }` based on file extension: `.py` -> python3, `.sh` -> bash, `.js` -> node, `.ts` -> deno/npx tsx, unknown -> direct execution

### Behavior 9: Cloud Script Execution

- **Given**: `SANDBOX_AUTH_TOKEN` is set in environment
- **When**: `getSkillScriptExecutor()` is called
- **Then**: Returns `CloudScriptExecutor` which creates a sandbox, uploads the script, executes with shell escaping, and cleans up
- **Edge cases**: Timeout races the sandbox command; on timeout, attempts kill before returning; sandbox.close() in finally block

### Behavior 10: Path Safety Validation

- **Given**: A skill root directory and a requested file path
- **When**: `validateSkillPath(root, path, allowedSubdirs, adapter?)` is called
- **Then**: Validates the path using centralized `validatePath()` with strict mode, verifies file exists, checks it's a regular file, rejects symlinks in the path, and for local files performs a realpath defense-in-depth check
- **Edge cases**: Rejects absolute paths; rejects parent traversal; rejects wrong subdirectories; rejects symlinks anywhere in the path chain

### Behavior 11: Allowed-Tool Enforcement

- **Given**: An allowed-tools policy (string array or undefined)
- **When**: `filterToolsForSkill(tools, allowed)` is called
- **Then**: Removes tool definitions not matching any pattern; skill-system tools always pass through
- **When**: `isToolAllowedBySkill(name, allowed)` is called
- **Then**: Returns true/false for a single tool call; skill-system tools always allowed
- **Edge cases**: `undefined` policy means no restrictions; empty array blocks all non-skill tools; invalid patterns always fail (fail closed); prefix wildcards match on colon-delimited prefix

### Behavior 12: Prompt Augmentation

- **Given**: A map of resolved skills
- **When**: `buildSkillManifestPrompt(skills)` is called
- **Then**: Returns a formatted markdown section listing skills and tool usage instructions
- **Edge cases**: Empty map returns empty string

## Constraints

- Do NOT change public API signatures
- Do NOT modify files outside src/skill/
- Must pass: deno fmt --check, deno lint, deno test

## Error Handling

All errors are created via `createError({ type: "agent", message })` and wrapped with `toError()` before throwing. Error types are always "agent" level. Errors are thrown synchronously or as rejected promises -- there is no error-return pattern. Script execution errors are captured as non-zero exit codes in `SkillScriptResult` rather than thrown exceptions.

## Side Effects

- **Registry**: `registerSkill` mutates the project-scoped skill registry (in-memory Map)
- **Filesystem**: `validateSkillPath` reads filesystem metadata (stat, lstat, realpath) to verify files and detect symlinks
- **Subprocess**: `LocalScriptExecutor` spawns child processes via `runCommand()`
- **Network**: `CloudScriptExecutor` creates remote sandboxes, uploads files, executes commands, and closes sessions
- **Environment**: `getSkillScriptExecutor` and `CloudScriptExecutor` read `SANDBOX_AUTH_TOKEN` from environment

## Performance Constraints

- Script execution timeout: default 60s, max 300s
- Description truncated to 1024 characters
- Skill names limited to 64 characters
- Cloud sandbox is lazy-imported to avoid bundling in non-cloud environments

## Invariants

- Skill IDs always match `SKILL_NAME_REGEX` (lowercase alphanumeric + hyphens, 1-64 chars)
- Allowed-tool patterns always match `SKILL_ALLOWED_TOOL_PATTERN_REGEX` or are rejected at parse time
- Skill file access is confined to the skill's root directory and its allowed subdirectories
- Symlinks are never followed in skill file paths
- Skill-system tools (`load-skill`, `load-skill-reference`, `execute-skill-script`) are always permitted regardless of allowed-tool policy
- Script timeout exit code is always 124
