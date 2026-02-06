# CLI Module

Command-line interface for Veryfront: development server, builds, deployment, and MCP server for coding agents.

## Quick Start

```bash
deno task dev              # Single-project dev server (port 3000)
deno task start            # Multi-project TUI dashboard (port 8080) + MCP
deno task start:headless   # Headless mode (no TUI, for coding agents)
deno task cli --help       # Show all commands
```

## Structure

```
cli/
├── main.ts              # Entry point
├── router.ts            # Routes parsed args to commands
├── index.ts             # Public exports
│
├── shared/              # Types (Zod schemas), constants, config, arg utilities
├── commands/            # Command implementations (dev, build, deploy, etc.)
│
├── app/                 # TUI dashboard
├── auth/                # Login, token storage, OAuth
├── sync/                # Project discovery, ignore patterns (used by pull/push)
├── mcp/                 # MCP server and tools for coding agents
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

| Command         | Description                         |
| --------------- | ----------------------------------- |
| `dev`           | Development server with HMR and TUI |
| `build`         | Production build                    |
| `deploy`        | Deploy to Veryfront                 |
| `init`          | Create new project                  |
| `generate`      | Scaffold pages, APIs, components    |
| `doctor`        | Project diagnostics                 |
| `login`         | Authenticate                        |
| `pull` / `push` | Sync with remote                    |

## Adding a New Command

Each command lives in `commands/<name>/` with this structure:

```
commands/my-command/
  command.ts       # Zod schema, createArgParser, and implementation
  command-help.ts  # Help text definition (CommandHelp object)
  handler.ts       # Thin handler: parse args → validate → call command
  handler.test.ts  # Handler tests
  command.test.ts  # Command implementation tests
  index.ts         # Barrel re-exports
```

**Reference implementation:** `commands/deploy/` follows this pattern cleanly.

### Steps

1. **`command.ts`** — Define a Zod schema for args, use `createArgParser` from `shared/args.ts`, implement the command function:

   ```typescript
   import { z } from "zod";
   import { CommonArgs, createArgParser } from "../../shared/args.ts";

   export const MyCommandArgsSchema = z.object({
     force: z.boolean().default(false),
   });

   export type MyCommandOptions = z.infer<typeof MyCommandArgsSchema>;

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
