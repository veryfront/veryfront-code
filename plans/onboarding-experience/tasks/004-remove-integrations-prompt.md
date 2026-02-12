# 004: Remove Integrations Prompt

## Summary
Remove integrations selection from onboarding wizard. Keep it simple.

## Files
- `cli/commands/init/interactive-wizard.ts`
- `cli/commands/init/interactive-wizard.test.ts`

## Checklist
- [ ] Remove `multiSelect` for integrations
- [ ] Remove integrations from `WizardResult`
- [ ] Update tests to reflect simplified flow
- [ ] Keep integrations available via `--integrations` CLI flag for power users

## Quality Gates
- [ ] Unit tests updated
- [ ] `deno task test:unit` passes
- [ ] `deno task lint` passes
- [ ] Manual test: no integrations prompt shown
