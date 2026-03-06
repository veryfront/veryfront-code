# NLSpec: src/discovery/

## Purpose

Automatic discovery and registration of tools, agents, resources, prompts,
workflows, tasks, and skills from a project directory. Servers call
`discoverAll()` at startup (and on HMR file changes) to scan convention-based
directories, transpile TypeScript modules via esbuild, dynamically import them,
validate their default exports against type-specific handlers, and register them
into their respective global registries. Skills follow a parallel markdown-based
path (SKILL.md frontmatter) rather than TypeScript import.

## Public API

### Exports

| Export | Type | Description |
|--------|------|-------------|
| `discoverAll` | `(config: DiscoveryConfig) => Promise<DiscoveryResult>` | Orchestrates full discovery across all item types |
| `clearTrackedAgents` | `() => void` | Clears the internal agent-path tracking map |
| `filenameToId` | `(filePath: string) => string` | Converts a file path to a camelCase identifier |
| `filePathToPattern` | `(filePath: string, baseDir: string) => string` | Converts a file path to a URL-style resource pattern |
| `clearTranspileCache` | `() => void` | Clears the in-memory transpile cache |
| `validateAIConfig` | `(config: VeryfrontConfig) => ValidationResult` | Validates AI provider configuration (pure, no ANSI) |
| `DiscoveryConfig` | type | Configuration for the discovery process |
| `DiscoveryHandler<T>` | type | Handler interface for type-specific discovery |
| `DiscoveryResult` | type | Result containing all discovered items and errors |
| `FileDiscoveryContext` | type | Context for file discovery (platform, fsAdapter, nodeDeps) |
| `ValidationResult` | type | Result of AI config validation (valid, warnings, errors) |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `detectPlatform` | `#veryfront/platform/core-platform.ts` | Detect runtime (deno/node) for context |
| `agentLogger` | `#veryfront/utils/logger/logger.ts` | Structured logging |
| `ensureError` | `#veryfront/errors/veryfront-error.ts` | Normalize unknown throws to Error |
| `registerSkill`, `skillRegistry` | `#veryfront/skill/registry.ts` | Register discovered skills |
| `parseSkillFrontmatter`, `validateSkillMetadata` | `#veryfront/skill/parser.ts` | Parse SKILL.md files |
| `registerTool` | `#veryfront/mcp` | Register tools in MCP registry |
| `registerAgent` | `#veryfront/agent` | Register agents in agent registry |
| `registerPrompt` | `#veryfront/mcp` | Register prompts in MCP registry |
| `registerResource` | `#veryfront/mcp` | Register resources in MCP registry |
| `registerWorkflow` | `#veryfront/workflow/registry.ts` | Register workflows |
| `isTaskDefinition` | `#veryfront/task/types.ts` | Validate task exports |
| `esbuild` (build) | `esbuild` | Transpile/bundle TypeScript for dynamic import |
| `createFileSystem` | `#veryfront/platform/compat/fs.ts` | Cross-platform file I/O |
| `isDeno`, `isDenoCompiled` | `#veryfront/platform/compat/runtime.ts` | Runtime detection for import rewriting |

## Behaviors

### Behavior 1: TypeScript item discovery (tools, agents, resources, prompts, workflows, tasks)

- **Given**: A `DiscoveryConfig` with `baseDir` and optional `*Dirs` overrides
- **When**: `discoverAll()` is called
- **Then**: For each item type, scans `{baseDir}/{dir}` recursively for `.ts`/`.tsx` files, transpiles each via esbuild, dynamically imports the bundled output, validates the default export using the type-specific handler, generates an ID (typically camelCase from filename), registers the item in its global registry, and adds it to the result map
- **Edge cases**: Missing directories are silently skipped (no error). Files that fail to transpile or whose default export fails validation are recorded in `result.errors` and skipped. When `verbose` is true, info/warn/error messages are logged.

### Behavior 2: Skill discovery (markdown-based)

- **Given**: A `DiscoveryConfig` with `skillDirs` (default `["skills"]`)
- **When**: `discoverAll()` is called
- **Then**: Clears the skill registry first, then for each skill dir, scans for subdirectories containing `SKILL.md`, parses frontmatter, validates metadata, and registers each skill. The directory name is used as the skill ID. Duplicates across discovery roots keep the first registration and log a warning.
- **Edge cases**: If metadata `name` differs from directory name, a warning is logged. Non-existent skill directories are silently skipped.

### Behavior 3: Module transpilation and import

- **Given**: A `.ts`/`.tsx` file path and a `FileDiscoveryContext`
- **When**: `importModule()` is called
- **Then**: Reads the source (via fsAdapter or local FS), bundles it with esbuild (marking external packages like `ai`, `zod`, `veryfront/*`), rewrites imports for the target runtime (Deno npm: specifiers or Node.js file:// URLs), writes to a temp file, dynamically imports it, caches the result, and cleans up the temp file.
- **Edge cases**: Results are cached by file path; subsequent calls return the cached module. For compiled Deno binaries, veryfront imports are rewritten to use `globalThis.__VERYFRONT_MODULES__`. When an fsAdapter is present, an esbuild plugin resolves and loads files through the adapter.

### Behavior 4: Import rewriting for Deno

- **Given**: Bundled JS code and a file directory path
- **When**: `rewriteForDeno()` is called
- **Then**: Rewrites bare npm package imports (`ai`, `zod`, `@ai-sdk/*`) to `npm:` specifier format, resolves relative `../` imports to absolute `file://` URLs, and (for compiled binaries) rewrites `veryfront/*` imports to destructure from `globalThis.__VERYFRONT_MODULES__`.

### Behavior 5: Import rewriting for Node.js

- **Given**: Bundled JS code, a project directory, and a file directory
- **When**: `rewriteDiscoveryImports()` is called
- **Then**: Resolves relative imports to `file://` URLs, walks up from `projectDir` to find npm packages in `node_modules` (up to 10 levels), resolves their entry points from `package.json` exports/module/main fields, and rewrites veryfront subpath imports using the package's export map (checking both `package.json` and `deno.json`).

### Behavior 6: AI config validation

- **Given**: A `VeryfrontConfig` object
- **When**: `validateAIConfig()` is called
- **Then**: Returns `{ valid: true, warnings: [], errors: [] }` if no providers are configured. For each provider missing an `apiKey`, adds a warning suggesting the corresponding `{NAME}_API_KEY` env var. Never sets `valid` to `false` (missing keys are warnings, not errors).

### Behavior 7: ID generation

- **Given**: A file path like `tools/search-web.ts`
- **When**: `filenameToId()` is called
- **Then**: Extracts the filename, strips the extension, converts kebab-case/snake_case to camelCase, and lowercases the first character. Example: `search-web.ts` -> `searchWeb`.

### Behavior 8: Resource pattern generation

- **Given**: A file path like `file:///.../resources/users/[userId]/profile.ts` and a base dir
- **When**: `filePathToPattern()` is called
- **Then**: Strips the `file://` prefix, removes the base dir prefix, strips the extension, converts `[param]` segments to `:param`, and prefixes with `/`. Example: `/users/:userId/profile`.

## Constraints

- Public API signatures must not change.
- Files outside `src/discovery/` must not be modified.
- The module must work on both Deno and Node.js runtimes.
- esbuild is required for transpilation; it is dynamically imported in Node paths.

## Error Handling

- File read failures throw with a descriptive message (`Failed to read file {path}`).
- Transpilation failures throw with the first esbuild error text.
- Per-file discovery errors are caught, wrapped via `ensureError()`, and accumulated in `result.errors` — they do not abort discovery of other files.
- Missing directories are silently ignored (return empty file lists).

## Side Effects

- Registers items in global registries (`toolRegistry`, `promptRegistry`, `resourceRegistry`, agent registry, workflow registry, `skillRegistry`).
- Clears `skillRegistry` before each rediscovery cycle.
- Tracks agent file paths in a module-level `Map` (for index generation).
- Creates and removes temporary files during transpilation.
- Sets `globalThis.__VERYFRONT_MODULES__` once for compiled Deno binaries.
- Maintains a module-level transpile cache (`Map<string, unknown>`).

## Performance Constraints

- Transpile results are cached in memory to avoid re-bundling unchanged files.
- The fsAdapter esbuild plugin caches `exists()` calls per build.
- Node.js `fs`/`path` modules are lazily imported and cached on the context.
- Skills directory scanning is I/O-bound but typically small (tens of directories).

## Invariants

- Every item in a result map has been successfully validated by its handler.
- Every registered item has a non-empty string ID.
- Skill IDs always match their directory name, regardless of frontmatter `name`.
- The first registration wins for duplicate IDs (both within a type and across skill roots).
- `discoverAll` always returns a complete `DiscoveryResult` — it never throws.
