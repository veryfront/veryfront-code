# Code Quality Improvements

## Code Quality Ideas for Next Iterations

### CLI Error Handling Consistency (High Impact)
- CLI code has **zero adoption** of the centralized VeryfrontError system (68+ error definitions in 11 categories)
- ~45 raw `new Error()` throws in CLI could use VeryfrontError slugs (e.g. `INPUT_VALIDATION_FAILED`, `ENV_VAR_MISSING`)
- Key files: `cli/shared/config.ts` (5 auth/config errors), `cli/commands/issues/command.ts` (16 errors), handler arg validation (5 handlers)
- 4 custom error classes in `src/` not yet consolidated: `NotSupportedError`, 3 timeout error classes

### Unused/Stale Exports
- `extractArg`/`extractArgs` in `cli/shared/args.ts` are exported but only used internally by `createArgParser` — tests import them directly though
- Many command `index.ts` files re-export `handle*Command` but `router.ts` imports directly from `handler.ts`
- `cli/app/logging/index.ts` re-exports `createCapture` and `parseRequestLog` but nobody imports from the barrel

### Type Safety
- `cli/commands/dev/dev.integration.test.ts` uses `any` for mock types
- `cli/mcp/server.ts` uses `any` for Zod schema introspection (line 451)
- Pre-existing type errors in `cli/app/state.test.ts` (lines 87, 97, 107, 346) — `?.data.slug` patterns on optional `data` field

### Other
- `start/handler.ts` still uses `__explicit?.port` check due to legacy parser default injection — consider cleaning up
- 5 large files (>600 lines): `templates/integration-loader.ts`, `mcp/remote-file-tools.ts`, `app/shell.ts`, `commands/demo/demo.ts`, `commands/generate/integration-generator.ts`
