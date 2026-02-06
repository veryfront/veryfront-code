# Code Quality Improvements

## Recently Completed
- CLI arg parser consolidation: `shared/arg-parser.ts` deleted, `parseCliArgs` moved to `shared/args.ts`
- Dead code removed: `parseArrayArg` function and tests
- `deno.json` import map entry for `#cli/shared/arg-parser` removed
- Multi-select UI deduplication: ~150 lines of duplicated terminal UI code between `install.ts` and `uninstall.ts` extracted into shared `cli/ui/components/multi-select.ts`
- Duplicate `parseTargetFlag` + `TargetFlagSchema` removed from `uninstall.ts` (now re-exports from `install.ts`)
- `MultiSelectOption` type moved from `cli/commands/install/types.ts` to `cli/ui/components/multi-select.ts` (generic `<T extends string>`)

## Code Quality Ideas for Next Iterations
- Error centralization PR (#247) is merged — look for more scattered error patterns
- CLI code review (#S1456-S1458) identified various improvements — see memory observations
- Consider extracting `TargetFlagSchema` + `parseTargetFlag` to a shared location if more commands need target parsing
- The `start/handler.ts` still uses `__explicit?.port` check due to legacy parser default injection — consider cleaning up
