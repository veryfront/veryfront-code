# cli/commands — Behavioral NLSpec

All CLI subcommand implementations for the Veryfront CLI. Each subcommand
follows a consistent three-file pattern: `command.ts` (business logic),
`handler.ts` (arg parsing + delegation), and `index.ts` (barrel exports).

## Architecture

### Module Layout

The top-level `index.ts` barrel re-exports the public API of 21 commands. An
additional set of commands (demo, init, issues, mcp, task, worker) are imported
directly by `cli/router.ts` via their handler files — they are not part of the
barrel because their handlers are the primary entry point.

Each subdirectory contains:

| File                         | Role                                                |
| ---------------------------- | --------------------------------------------------- |
| `command.ts`                 | Core business logic and domain types                 |
| `handler.ts`                 | Zod schema, `createArgParser`, delegation to command |
| `index.ts`                   | Barrel re-exports                                    |
| `command-help.ts`            | `CommandHelp` object for the help system             |
| `types.ts` (optional)        | Shared types when needed across files                |
| `*.test.ts`                  | Unit tests                                           |
| `*.integration.test.ts`      | Integration tests                                    |
| `CLAUDE.md`                  | Agent memory context                                 |

### Handler Pattern

Most handlers follow one of two patterns:

**Standard pattern** (majority of commands):
```
export async function handleXCommand(args: ParsedArgs): Promise<void> {
  showLogo();
  await xCommand(parseArgsOrThrow(parseXArgs, "x", args));
}
```

**ProjectDir pattern** (clean, lock):
```
export async function handleXCommand(args: ParsedArgs): Promise<void> {
  await handleProjectDirCommand(args, parseXArgs, "x", xCommand);
}
```

### Arg Parsing

Every command defines a Zod schema and creates a typed parser via
`createArgParser(schema, argMap)`. The parser is invoked via
`parseArgsOrThrow(parser, commandName, args)` which throws a user-friendly
error on validation failure.

## Commands

### build

Builds a project for production. Supports an `embedded` preset for bundled
output. Wraps all work in an OTLP span (`cli.command.build`).

- `command.ts` — calls `buildProduction()` from `veryfront/build` with options
  for splitting, compression, prefetch, SSG, include/exclude globs, and dry-run.
- `config-display.ts` — prints build configuration to console.
- `stats-display.ts` — prints build statistics (pages, chunks, assets, size,
  time) and dry-run SSG path preview.
- `error-handler.ts` — formats build errors with truncated stack traces and
  exits the process.
- `types.ts` — re-exports `BuildOptions` and `BuildStats` from
  `veryfront/server`.

### dev

Starts the development server with HMR. Wraps in OTLP span (`cli.command.dev`).

- Resolves project directory from `--project` flag or cwd.
- Loads config, validates AI configuration, optionally pre-compiles MDX.
- Starts dev server, MCP server, checks existing auth.
- Keyboard handler enables interactive shortcuts: open browser (o), clear
  console (c), quit (q), auth (a), project sync (s), pull (p), push (u),
  number keys for project selection.
- Returns `{ ready, done, stop }` for programmatic control (used by demo mode).

### generate

Scaffolds pages, layouts, API routes, and integrations.

- Supports `page`, `layout`, `api`, `rsc`, and `integration` types.
- Detects preferred router (`app-router` or `pages-router`) from project config.
- `integration-generator.ts` — interactive wizard to scaffold a full service
  integration with OAuth routes, API client, token store, and tool skeletons.

### init

Creates a new Veryfront project from templates.

- `interactive-wizard.ts` — TUI wizard for project location, template selection,
  and git init preference. Skips wizard when `--template` is explicitly set or
  in CI/test environments.
- `catalog.ts` — single source of truth for templates (7 options) and
  integrations (40+ services across 11 categories).
- `config-generator.ts` — creates `package.json` with React, Veryfront, and
  Zod dependencies.
- `init-command.ts` — orchestrates: validate name, run wizard, load template,
  resolve features, load integrations, write files, prompt for env vars,
  generate `.gitignore`, optionally init git and install deps, optionally deploy.
- `path-utils.ts` — `resolvePath()` helper for config file resolution.
- `types.ts` — `InitTemplate` union type and `InitOptions` interface.

### install / uninstall

Installs or removes AI assistant integration files (Cursor, Claude Code, Agent
Skills, GitHub Copilot, Windsurf, Codex/Gemini).

- `registry.ts` — tool definitions mapping tool IDs to file paths and templates.
- `detect.ts` — auto-detects which AI tools are in use by checking for
  configuration directories/files and env vars.
- `install.ts` — `installTargets()` writes template files; `installCommand()`
  runs interactive multi-select or parses `--target` flag.
- `uninstall.ts` — `uninstallTargets()` removes files and empty parent dirs;
  `uninstallCommand()` shows multi-select of installed tools.
- `types.ts` — Zod schemas for tool IDs, tool metadata, install/uninstall/
  detect options.

### pull

Downloads project files from the Veryfront API.

- Supports four pull sources: main, branch, environment, release (priority:
  env > release > branch > main).
- Validates file paths against path traversal attacks.
- Fetches file list with pagination, then downloads content in batches of 20
  concurrent requests.
- Supports multi-project pull via `--projects` flag.
- Wraps in OTLP span (`cli.command.pull`).

### push

Uploads local project files to a new Veryfront branch.

- Scans local files respecting `.vfignore` patterns and supported extensions.
- Compares local vs remote files to determine uploads and deletions.
- Creates a new branch (unless pushing to main) and uploads/deletes files.
- On first push, auto-creates the project via `reserveProjectSlug`.
- Wraps in OTLP span (`cli.command.push`).

### merge

Merges a branch into main (or another target branch).

- Looks up branches by name with pagination.
- Supports `--dry-run` to preview merge diffs and conflict detection.
- Requires confirmation unless `--force` is set.

### deploy

Creates a release and deploys to an environment.

- Looks up environment by name with pagination.
- Creates a release from the specified branch, then creates a deployment
  linking the release to the environment.
- Supports `--dry-run`, `--force`, and `--quiet` modes.

### up

One-command push + deploy workflow.

- Analyzes directory to determine context: empty, has code, or has existing
  project config.
- For new projects: prompts for slug, creates project via API, saves config.
- Pushes to main branch, then deploys to preview environment.

### clean

Removes project artifacts and caches.

- Supports granular flags: `--cache`, `--build`, `--all`.
- `--all` requires confirmation (removes node_modules, .deno, .veryfront).
- Cache cleaning creates and clears the appropriate cache store (memory,
  filesystem, KV, or Redis) based on project config.

### lock

Manages the import lockfile for remote ESM imports.

- Subcommands: `--list` (default), `--clear`, `--verify`, `--update`.
- `--verify` fetches each URL and recomputes integrity hashes.
- `--update` re-fetches all URLs and updates resolved URLs and integrity.
- `--clear` requires confirmation unless `--force` is set.

### routes

Lists project pages and API routes.

- Scans `pages/` directory for `.mdx` and `.tsx` files.
- Recursively collects API route patterns from `pages/api/`.
- Supports `--json` output format.

### serve

Runs the production server in various modes.

- `production` mode: clears caches, initializes OTLP and distributed caches,
  starts production server with graceful shutdown.
- `proxy` mode: starts the proxy server only.
- `split` mode: orchestrates separate production server and proxy processes
  simulating K8s architecture. Validates required env vars, waits for server
  readiness, and handles graceful shutdown of both processes.

### start

Multi-project dev server with TUI and proxy support.

- Discovers projects in `data/projects/` and `projects/` directories.
- Optionally sets up proxy handler for multi-tenant routing.
- Creates MCP server on a separate port.
- Includes global error handling for fatal errors (stack overflow, OOM).

### studio

Opens Veryfront Studio in the browser.

- Resolves project slug from env, config file, package.json name, or directory.
- Builds Studio URL with optional branch and file query params.

### doctor

Runs system diagnostics and project health checks.

- Version checks: Deno (>= 1.40.0) and Node.js (>= 18) detection, React
  compatibility.
- Project structure: checks for `pages/` and `pages/index.mdx`.
- Configuration: validates config loading and React version.
- Cache system: reports built-in LRU cache status.
- RSC checks: probes manifest, stream, and metrics endpoints on localhost:3000.
- AI checks: validates AI provider configuration and API keys.
- `--strict` mode treats warnings as errors.

### demo

Interactive guided tour of the Veryfront CLI.

- Six-step walkthrough: intro, login, create project, dev server, deploy, done.
- Supports `--auto` mode for automated advancement with countdown timers.
- Uses raw terminal input for keyboard navigation in auth method selection.
- Animated dot matrix logo and typing effects.
- Tracks per-step timing for progress display.

### issues

File-based issue tracking (CRUD operations on markdown issue files).

- Subcommands: create, list/ls, view/show/get, edit/update, close, reopen,
  delete/rm.
- Supports filtering by state, labels, milestone, assignee, prefix (ISSUE/TASK/
  PLAN).
- Supports `--json` output and `--verbose` detail mode.

### analyze-chunks

Analyzes shared dependencies across pages for code splitting optimization.

- Reports top shared dependencies and suggested chunk configurations.
- Detects heavy UI libraries (MUI, Framer Motion, Three.js).
- Optionally outputs a chunk manifest JSON file.

### mcp

Starts a standalone MCP server.

- Keeps process alive until SIGINT/SIGTERM.

### task

Discovers and runs tasks from the `tasks/` directory.

- Discovers task files, finds the named task, parses optional `--config` JSON,
  and runs via `runTask()`.

### worker

Starts the workflow job manager.

- Polls Redis for pending/stalled workflow runs.
- Executes jobs as isolated processes via `ProcessJobExecutor`.
- Reports job statistics on shutdown.

### new (unused)

Project scaffolding utilities. Contains `fast-scaffold.ts` and a deprecated
re-export of `reserveProjectSlug`. **Not imported anywhere in the codebase** --
neither by the router nor the barrel. This is dead code.

## Test Files

### Misplaced

- `generate.test.ts` lives directly in `cli/commands/` instead of in the
  `cli/commands/generate/` subdirectory alongside the implementation.

## Cross-Cutting Concerns

### Observability

Build, dev, pull, and push commands wrap their work in OTLP spans via
`withSpan()` from `veryfront/observability/otlp-setup`.

### Auth

Commands requiring API access (pull, push, merge, deploy, up) use
`resolveConfigWithAuth()` which prompts for interactive login if needed. The
dev command checks for existing auth non-fatally.

### Graceful Shutdown

Long-running commands (dev, serve, start, worker) register SIGINT/SIGTERM
handlers via `registerTerminationSignals()` and implement guarded shutdown
sequences with `shuttingDown` flags.
