# 007: Success Box

## Summary
Display success box with next steps after project creation.

## Files
- `cli/commands/init/success-box.ts` (new)
- `cli/commands/init/success-box.test.ts` (new)
- `cli/commands/init/init-command.ts`

## Checklist
- [ ] Create `renderSuccessBox()` function
- [ ] Use `cli/ui/box.ts` for box rendering
- [ ] Dynamic content based on:
  - Location (show `cd project-name` if new folder)
  - Package manager (show correct dev command)
- [ ] Include deploy command hint

## Output Example
```
├─────────────────────────────────────────╮
│                                         │
│  ✓ Created my-app                       │
│                                         │
│  Next steps:                            │
│    cd my-app                            │
│    pnpm dev                             │
│                                         │
├─────────────────────────────────────────╯
```

## Quality Gates
- [ ] Unit tests for all scenarios
- [ ] `deno task test:unit` passes
- [ ] `deno task lint` passes
- [ ] Manual test: box renders correctly
