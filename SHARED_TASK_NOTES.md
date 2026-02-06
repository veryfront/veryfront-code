# CLI Refactoring - Shared Task Notes

## Goal
Refactor src/cli for code quality and maintainability.

## createArgParser Migration Status

All command handlers that need structured arg parsing are now migrated to the Zod-based `createArgParser` pattern from `shared/args.ts`.

### Fully migrated (15 handlers)
build, clean, deploy, dev, doctor, install, lock, merge, mcp, new, pull, push, routes, serve, start

### No structured parser needed (7 handlers)
analyze-chunks, demo, generate, init, issues, studio, whoami — these either have minimal args extracted inline or pass args directly to their command function.

### Key patterns
- `start/handler.ts` needs `__explicit?.port` check because legacy `parseCliArgs` injects `port: 3000` as default, but start command defaults to 8080
- `serve/handler.ts` has a `--binary` flag that can be boolean OR string path — handled outside the schema
- `build/handler.ts` uses a Zod transform for `include`/`exclude` (string → string[])
- `install/handler.ts` shares a single parser between install and uninstall commands

## What's left for CLI refactoring

### Dead code cleanup
- `BuildCommandArgs` was removed from `shared/types.ts` (no longer used)
- `parseArrayArg` in `shared/arg-parser.ts` is no longer used by any handler (only re-exported from `cli/index.ts`). Could be removed if no external consumers.
- `GenerateCommandArgs` in `shared/types.ts` is still used by `generate/handler.ts`

### Potential next steps
1. **Migrate remaining simple handlers** (analyze-chunks, demo, issues, studio, whoami) to `createArgParser` — low value since they have minimal args
2. **Consolidate error handling** — some handlers throw on parse failure, others don't. Standardize.
3. **Remove legacy `parseCliArgs` default port injection** — the `port: DEFAULT_PORT` default in `arg-parser.ts` causes confusion for handlers with different port defaults (start, mcp). Would need router-level changes.
4. **Review command.ts files** — some commands have their own option interfaces that could be aligned with the Zod schemas
5. **General code quality pass** — look for other patterns to consolidate across the CLI codebase
