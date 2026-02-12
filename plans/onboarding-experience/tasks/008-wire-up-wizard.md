# 008: Wire Up Wizard Flow

## Summary
Integrate all new components into the init command flow.

## Files
- `cli/commands/init/init-command.ts`
- `cli/commands/init/interactive-wizard.ts`

## Checklist
- [ ] Update wizard flow order:
  1. Location prompt
  2. Template selection
  3. Git init prompt
  4. Install deps prompt
- [ ] Pass package manager through flow
- [ ] Call progress steps during execution
- [ ] Display success box at end
- [ ] Handle errors gracefully

## Quality Gates
- [ ] Integration tests for full flow
- [ ] `deno task test:unit` passes
- [ ] `deno task lint` passes
- [ ] Manual test: full flow works end-to-end
