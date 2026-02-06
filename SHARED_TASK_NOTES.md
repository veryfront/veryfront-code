# CLI Refactoring: Zod createArgParser Migration

## Status: Complete

All CLI command handlers now use the `createArgParser` pattern from `cli/shared/args.ts`.

## Pattern Reference
See any handler file (e.g., `cli/commands/deploy/handler.ts`) for the canonical pattern:
- Schema + parser defined in handler.ts (or command.ts for complex commands)
- Use `CommonArgs` from `shared/args.ts` for reusable arg specs
- Handler validates with `parseFooArgs(args)`, throws on failure, calls command with `result.data`

## What Was Done
- Added `"array"` type to `ArgSpec` for CSV/repeated flag args (pull's `--projects`, build's `--include`/`--exclude`)
- Migrated pull and push from manual `getStringArg`/`resolveProjectDir` extraction to `createArgParser`
- Migrated install/uninstall from manual `args.foo` access to `createArgParser`
- Moved build's `include`/`exclude` from legacy `parseArrayArg` into Zod schema + argMap
- Removed dead code: `getStringArg()` and `resolveProjectDir()` from `shared/args.ts`, unused `cwd` import

## Cleanup Opportunities (Next Steps)
1. **Remove `parseArrayArg` from `shared/arg-parser.ts`** — no longer used by any production code (only its test file imports it). Can remove the function + its tests.
2. **Consider removing `shared/arg-parser.ts` entirely** — only `parseCliArgs` (top-level arg parser used in `cli/main.ts`) and `parseArrayArg` (dead) remain. Could move `parseCliArgs` to `shared/args.ts` to consolidate into one module.
3. **Deduplicate install/uninstall multiSelect UI code** — ~100 lines duplicated between `install.ts` and `uninstall.ts`

## Other Code Quality Ideas
- CLI code review (#S1456-S1458) identified various improvements — see memory observations for details
- Error centralization PR (#247) merged — 7 scattered error classes replaced with `VeryfrontError` + slug registry
