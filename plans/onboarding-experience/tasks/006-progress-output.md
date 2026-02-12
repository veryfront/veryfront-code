# 006: Progress Output

## Summary
Add branded progress output with spinners during project creation.

## Files
- `cli/commands/init/progress.ts` (new)
- `cli/commands/init/progress.test.ts` (new)
- `cli/commands/init/init-command.ts`

## Checklist
- [ ] Create `createProgress()` class/function
- [ ] Methods: `start(label)`, `succeed(label)`, `fail(label)`
- [ ] Use brand colors from `cli/ui/colors.ts`
- [ ] Symbols: `●` active (orange), `✓` done (green), `✗` fail (red)
- [ ] Integrate into init command flow

## Progress Steps
1. Scaffolding files
2. Initializing git (if enabled)
3. Installing dependencies (if enabled)

## Quality Gates
- [ ] Unit tests for progress output
- [ ] `deno task test:unit` passes
- [ ] `deno task lint` passes
- [ ] Manual test: progress shows correctly in terminal
