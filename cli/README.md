# CLI Module

Command-line interface for Veryfront: development server, builds, deployment, and MCP server for coding agents.

## Quick Start

```bash
deno task dev              # Single-project dev server (port 3000)
deno task start            # Multi-project TUI dashboard (port 8080) + MCP
deno task start:headless   # Headless mode (no TUI, for coding agents)
deno task cli --help       # Show all commands
```

Mode and process-model overview:

- `../docs/server-modes.md`

## Structure

```
cli/
├── main.ts              # Entry point
├── router.ts            # Routes parsed args to commands
├── index.ts             # Public exports
│
├── shared/              # Types (schemas), constants, config, arg utilities
├── commands/            # Command implementations (40+ commands)
│
├── app/                 # TUI dashboard
├── auth/                # Login, token storage, OAuth
├── sync/                # Project discovery, ignore patterns (used by pull/push)
├── mcp/                 # MCP server, tools, and skills for coding agents
├── skills/              # Skill loader and type definitions
│
├── ui/                  # Colors, ANSI, box drawing
├── utils/               # General utilities
├── help/                # Command definitions, help formatting
├── discovery/           # User project file discovery (tools, agents)
├── templates/           # Project and integration templates
└── test-utils/          # VCR testing utilities
```

## Commands

Run `veryfront <command> --help` for options:

| Command         | Description                          |
| --------------- | ------------------------------------ |
| `dev`           | Development server with HMR and TUI  |
| `build`         | Production build                     |
| `deploy`        | Deploy to Veryfront                  |
| `init`          | Create new project                   |
| `generate`      | Scaffold pages, APIs, components     |
| `doctor`        | Project diagnostics                  |
| `login`         | Authenticate                         |
| `logout`        | Clear authentication                 |
| `whoami`        | Show current authenticated user      |
| `pull` / `push` | Sync with remote                     |
| `uploads`       | List, pull, put, and delete uploads  |
| `files`         | List, get, put, and delete files     |
| `knowledge`     | Knowledge-base ingestion workflow    |
| `skills`        | Manage agent skills                  |
| `task`          | Run project tasks                    |
| `workflow`      | Manage and inspect workflows         |
| `mcp`           | Start MCP server for coding agents   |
| `start`         | Multi-project TUI dashboard          |
| `serve`         | Production HTTP server               |
| `worker`        | Start workflow worker process        |
| `routes`        | List project routes                  |
| `schema`        | Generate or inspect schemas          |
| `extension`     | Manage extensions                    |
| `config`        | View or modify project configuration |
| `studio`        | Open Studio UI                       |

Use one or more `uploads/...` paths for remote project-upload references in `veryfront knowledge ingest`; use `./uploads/...` or `/workspace/uploads/...` to force a local sandbox path.
`veryfront knowledge ingest` requires `python3`; inside the Veryfront sandbox it uses `docling` for PDF, Office, and HTML extraction, and outside the sandbox it falls back to the supported parser packages when `docling` is unavailable or extraction fails.

## Adding a New Command

Each command lives in `commands/<name>/` with this structure:

```
commands/my-command/
  command.ts       # Schema (defineSchema), createArgParser, and implementation
  command-help.ts  # Help text definition (CommandHelp object)
  handler.ts       # Thin handler: parse args → validate → call command
  handler.test.ts  # Handler tests
  command.test.ts  # Command implementation tests
  index.ts         # Barrel re-exports
```

**Reference implementation:** `commands/deploy/` follows this pattern cleanly.

### Steps

1. **`command.ts`** — Define a schema for args with `defineSchema`, use `createArgParser` from `shared/args.ts`, implement the command function:

   ```typescript
   import { defineSchema } from "veryfront/schemas";
   import type { InferSchema } from "veryfront/extensions/schema";
   import { CommonArgs, createArgParser } from "../../shared/args.ts";

   export const getMyCommandArgsSchema = defineSchema((v) =>
     v.object({
       force: v.boolean().default(false),
     })
   );
   export const MyCommandArgsSchema = getMyCommandArgsSchema();

   export type MyCommandOptions = InferSchema<ReturnType<typeof getMyCommandArgsSchema>>;

   export const parseMyCommandArgs = createArgParser(MyCommandArgsSchema, {
     force: CommonArgs.force,
   });

   export async function myCommand(options: MyCommandOptions): Promise<void> {
     // implementation
   }
   ```

2. **`handler.ts`** — Keep it thin (< 20 lines). Parse, validate, delegate:

   ```typescript
   import { myCommand, parseMyCommandArgs } from "./command.ts";
   import type { ParsedArgs } from "../../shared/types.ts";

   export async function handleMyCommand(args: ParsedArgs): Promise<void> {
     const result = parseMyCommandArgs(args);
     if (!result.success) {
       throw new Error(`Invalid arguments: ${result.error.message}`);
     }
     await myCommand(result.data);
   }
   ```

3. **`command-help.ts`** — Define help text using `CommandHelp` type
4. **`index.ts`** — Barrel re-exports for command, handler, and types
5. **`router.ts`** — Add handler import and switch case
6. **`help/command-definitions.ts`** — Register the help definition
7. **`commands/index.ts`** — Add exports

### Conventions

- Handlers parse `ParsedArgs` → typed options. Commands receive typed options only.
- Use `CommonArgs` for shared flags (`force`, `dryRun`, etc.)
- Colocate tests: `handler.test.ts` and `command.test.ts` alongside implementation
- `index.ts` is always a barrel file, never contains implementation

## Testing

```bash
deno test src/cli/ --allow-all
```

## Related

- **STYLE_GUIDE.md** - CLI output conventions
- **mcp/skills/** - MCP skill definitions
- **../observability/** - Error collection used by MCP tools
