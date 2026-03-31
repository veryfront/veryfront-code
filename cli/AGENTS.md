# CLI Module — Agent Guide

The `cli/` directory is the entry layer for the Veryfront CLI. All user-facing commands, help output, MCP server, and shared utilities live here.

## Directory Structure

```
cli/
├── router.ts              # Command dispatch — maps command names to handlers
├── main.ts                # CLI entry point — parses argv, calls routeCommand()
├── shared/
│   ├── args.ts            # Arg parsing: createArgParser(), CommonArgs, parseCliArgs()
│   ├── types.ts           # ParsedArgs interface
│   ├── json-output.ts     # JSON envelope utilities (isJsonMode, outputJson, etc.)
│   ├── interactive.ts     # --yes / CI detection (isInteractive, detectCI)
│   ├── config.ts          # Project config resolution + API client
│   └── slug.ts            # Project slug utilities
├── commands/
│   └── {name}/
│       ├── handler.ts     # Entry: parseArgs → call command function
│       ├── command.ts      # Business logic + Zod schema
│       ├── command-help.ts # Help definition (CommandHelp object)
│       └── handler.test.ts # Tests
├── help/
│   ├── types.ts           # CommandHelp, CommandCategory, CommandOption
│   ├── command-definitions.ts  # Central COMMANDS registry
│   ├── main-help.ts       # Main help output (grouped by category)
│   └── formatters.ts      # Terminal formatting utilities
├── mcp/
│   ├── server.ts          # MCP server (stdio + HTTP)
│   ├── tools.ts           # Core MCP tools
│   └── advanced-tools.ts  # Extended MCP tools registry
├── auth/                  # login, logout, whoami
├── ui/                    # Colors, spinners, box drawing
└── utils/                 # Logger, VERSION, confirmPrompt, exitProcess
```

## Adding a New Command

1. **Create command directory:** `cli/commands/{name}/`
2. **Define help** in `command-help.ts`:
   ```typescript
   import type { CommandHelp } from "../../help/types.ts";
   export const fooHelp: CommandHelp = {
     name: "foo",
     category: "development",  // development | deploy | project | files | ai | auth
     description: "...",
     usage: "veryfront foo [options]",
     options: [{ flag: "--bar", description: "..." }],
     examples: ["veryfront foo --bar"],
   };
   ```
3. **Define args + logic** in `command.ts` using Zod + `createArgParser`:
   ```typescript
   const FooSchema = z.object({ bar: z.boolean().default(false) });
   export const parseFooArgs = createArgParser(FooSchema, {
     bar: { keys: ["bar"], type: "boolean" },
   });
   ```
4. **Create handler** in `handler.ts`:
   ```typescript
   export async function handleFooCommand(args: ParsedArgs): Promise<void> {
     const opts = parseArgsOrThrow(parseFooArgs, "foo", args);
     // ... command logic
   }
   ```
5. **Register** in `cli/router.ts`: import + add to `commands` record
6. **Register help** in `cli/help/command-definitions.ts`: import + add to `COMMANDS`

## Global Flags

Handled in `routeCommand()` in `router.ts`:
- `--json` / `-j` → `setJsonMode(true)` — enables structured JSON output
- `--output` / `-o` → `setOutputPath(path)` — write JSON to file
- `--yes` / `-y` → `setNonInteractive(true)` — skip prompts (auto-detected in CI)
- `--quiet` / `-q`, `--verbose`, `--no-color`, `--color`, `--help`, `--version`

## JSON Output Pattern

Commands that support `--json` use the envelope format:
```typescript
import { isJsonMode, outputJson, createSuccessEnvelope } from "../../shared/json-output.ts";

if (isJsonMode()) {
  await outputJson(createSuccessEnvelope("command-name", { key: "value" }));
  return;
}
```

## Arg Parsing

- Single-char aliases defined in `parseCliArgs()` in `shared/args.ts`
- Reusable specs in `CommonArgs` (force, dryRun, branch, env, projectSlug, etc.)
- New aliases: add to the `alias` object in `parseCliArgs()`

## Testing

- Test file: `cli/commands/{name}/handler.test.ts`
- Run single: `VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all cli/commands/{name}/`
- Run all CLI: `VF_DISABLE_LRU_INTERVAL=1 deno test --no-check --allow-all --parallel '--ignore=tests,src/ai/workflow/__tests__,src/cli/commands/*.integration.test.ts' cli/`
- BDD style: `describe()` / `it()` from `#veryfront/testing/bdd.ts`
- Assertions: `assertEquals`, `assertRejects`, etc. from `#veryfront/testing/assert.ts`

## Common Mistakes

- Forgetting to register in **both** `router.ts` AND `command-definitions.ts`
- Using wrong import path for shared modules (use `#cli/shared/args` across module boundaries, relative within `cli/`)
- Missing `category` field in command-help (required by `CommandHelp` interface)
- Not handling JSON mode in new commands (check `isJsonMode()` before human-readable output)
