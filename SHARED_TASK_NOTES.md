# CLI Refactoring: Zod createArgParser Migration

## Goal
Migrate all CLI command handlers from manual argument parsing to Zod-based `createArgParser` pattern.

## Pattern Reference
See `src/cli/commands/deploy/handler.ts` + `command.ts` for the canonical pattern:
- Schema + parser defined in handler.ts (or command.ts for complex commands)
- Use `CommonArgs` from `shared/args.ts` for reusable arg specs
- Handler validates with `parseFooArgs(args)`, throws on failure, calls command with `result.data`

## Migration Status

### Migrated (10 handlers)
- lock, clean, init, studio, generate (earlier iterations)
- doctor, routes, analyze-chunks, mcp, demo (this iteration)

### Still Need Migration (7 handlers)
Priority order (simpler first):
1. **install** - Manual `args.target`, `args.global`, `args.force` access. Also has 100+ lines of duplicated multiSelect UI code between install.ts and uninstall.ts
2. **start** - Uses `args.__explicit?.port` for explicit flag detection, complex port handling
3. **serve** - Manual parsing with multiple key variations (`args.mode`, `args.m`, `args.host`, `args.hostname`)
4. **build** - Uses `parseArrayArg` from legacy `shared/arg-parser.ts` for include/exclude arrays. Has `exitProcess(0)` call
5. **dev** - Complex project resolution logic, manual `args.project`, `args.port`, `args.hmr`
6. **pull** - Has Zod schema but uses custom safeParse, not createArgParser
7. **push** - Same as pull, has Zod schema but uses custom safeParse

### Not Migrating
- **new** - Has `exitProcess(0)` for user cancellation in interactive TUI, acceptable
- **mcp** note: The CLI framework injects `DEFAULT_PORT=3000` as default for `--port`. MCP server needs its own default (8080). Handler has a filter for this.

## Known Issues
- `shared/arg-parser.ts` (legacy) coexists with `shared/args.ts` (new). Once all handlers migrate, the legacy module can be removed (except `parseArrayArg` used by build)
- `CommonArgs.projectDir` uses `--project-dir`, `--dir`, `-d` — some old commands used `--project`. Migration standardizes this.

## After All Handlers Are Migrated
- Remove/reduce `shared/arg-parser.ts` (keep `parseArrayArg` if needed)
- Consider extracting `parseArrayArg` into `shared/args.ts` as array support
- Deduplicate install/uninstall multiSelect UI code
