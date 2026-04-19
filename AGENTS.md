# Veryfront — Agent Guide

Veryfront is a full-stack web framework with CLI tooling for dev, build, deploy, and AI features. Runtime: **Deno**.

## Quick Start

```bash
# Command discovery
veryfront schema --json

# MCP server (for Claude Code, Cursor, etc.)
veryfront mcp

# Run tests
VF_DISABLE_LRU_INTERVAL=1 SSR_TRANSFORM_PER_PROJECT_LIMIT=0 REVALIDATION_PER_PROJECT_LIMIT=0 \
  NODE_ENV=production LOG_FORMAT=text \
  deno test --no-check --allow-all --unstable-worker-options --unstable-net

# Unit tests only (parallel, excludes integration)
deno test --no-check --allow-all --parallel \
  '--ignore=tests,src/workflow/__tests__,cli/commands/*.integration.test.ts'
```

## CLI Usage

### Structured Output

All commands support `--json` for machine-readable output:

```bash
veryfront deploy --json
veryfront doctor --json
veryfront whoami --json
```

**Success envelope:**

```json
{ "success": true, "command": "deploy", "data": { ... }, "timing": { "duration_ms": 3200 } }
```

**Error envelope:**

```json
{
  "success": false,
  "command": "deploy",
  "error": {
    "code": "PERMISSION_ERROR",
    "slug": "deploy-not-authorized",
    "message": "...",
    "context": {}
  }
}
```

### Global Flags

| Flag              | Short | Description                                     |
| ----------------- | ----- | ----------------------------------------------- |
| `--json`          | `-j`  | Structured JSON output                          |
| `--output <path>` | `-o`  | Write JSON output to file                       |
| `--yes`           | `-y`  | Skip confirmation prompts (auto-detected in CI) |
| `--quiet`         | `-q`  | Suppress non-essential output                   |
| `--verbose`       |       | Enable debug logging                            |
| `--no-color`      |       | Disable color output                            |

### Exit Codes

| Code | Meaning              |
| ---- | -------------------- |
| 0    | Success              |
| 1    | Error                |
| 2    | Usage error          |
| 130  | Interrupted (SIGINT) |

## MCP Connection

**stdio (local editors):**

```bash
veryfront mcp
```

**HTTP (remote access):**
MCP auto-starts on `--port` + 2 (default: 3002) with `veryfront dev`. With `veryfront start`, MCP defaults to port 9999.

**Key tools:** `vf_list_templates`, `vf_create_project`, `vf_scaffold`, `vf_get_errors`, `vf_get_project_context`, `vf_list_routes`, `vf_get_conventions`, `vf_get_component_tree`, `vf_hot_reload`

**Resources:** `veryfront://skill`, `veryfront://errors`, `veryfront://logs`, `veryfront://schema`, `veryfront://agents-md`

## Agent Workflows

### Session Start

Call `vf_bootstrap` once at session start for full project context:

```
# Single call replaces: vf_get_project_context + vf_get_conventions + vf_get_errors + vf_get_status
vf_bootstrap()
```

### Development Loop (Flywheel)

1. Edit code
2. `vf_trigger_hmr({ path: "app/page.tsx" })` — push changes to browser
3. `vf_get_errors()` — check for compile/runtime errors
4. `vf_run_tests({ filter: "page" })` — run related tests
5. `vf_run_lint()` — check for lint issues
6. Iterate

### Build & Deploy

1. `vf_run_tests({ parallel: true })` — full test suite
2. `vf_run_lint()` — verify no lint issues
3. `vf_build({ dryRun: true })` — preview build output
4. `vf_build()` — production build

## Architecture

```
src/                    # Core framework modules
├── agent/              # AI agents
├── build/              # Build pipeline
├── config/             # Configuration resolution
├── errors/             # VeryfrontError registry
├── mcp/                # MCP protocol types
├── platform/           # Deno/Node platform abstraction
├── provider/           # AI model providers
├── tool/               # Tool definitions
├── workflow/           # AI workflows
└── ...

cli/                    # CLI layer (see cli/AGENTS.md for details)
├── router.ts           # Command dispatch
├── commands/           # Individual commands (handler.ts + command.ts + command-help.ts)
├── mcp/                # MCP server + tools
├── help/               # Help system with categories
├── shared/             # Args, JSON output, interactive mode
├── auth/               # login, logout, whoami
├── ui/                 # Colors, spinners
└── utils/              # Logger, VERSION, prompts
```

### Hash Imports

- `#veryfront/` — src modules (e.g., `#veryfront/errors`, `#veryfront/config`)
- `#cli/` — CLI modules (e.g., `#cli/shared/args`, `#cli/utils`)
- `veryfront/` — public API surface (e.g., `veryfront/platform`, `veryfront/mcp`)

Import map defined in `deno.json`.

## Contributing Conventions

### Error Handling

Use the `VeryfrontError` registry pattern:

```typescript
import { defineError } from "#veryfront/errors";
const MY_ERROR = defineError("my-error-slug", ErrorCode.CONFIG_ERROR, 400);
throw MY_ERROR.create("Something went wrong", { detail: "extra context" });
```

Match errors with: `error instanceof VeryfrontError && error.slug === "my-error-slug"`

### Tests

- BDD style: `describe()` / `it()` from `#veryfront/testing/bdd.ts`
- Assertions from `#veryfront/testing/assert.ts`
- Test files: colocated as `*.test.ts` next to source

### Arg Parsing

```typescript
import { z } from "zod";
import { CommonArgs, createArgParser } from "#cli/shared/args";

const Schema = z.object({ force: z.boolean().default(false) });
const parseArgs = createArgParser(Schema, { force: CommonArgs.force });
```

### Command Structure

Each command lives in `cli/commands/{name}/` with:

- `handler.ts` — entry point, signature: `(args: ParsedArgs) => Promise<void>`
- `command.ts` — Zod schema, arg parser, business logic
- `command-help.ts` — `CommandHelp` object with name, category, description, usage, options, examples
