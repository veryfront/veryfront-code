# 011: End-to-End Tests

## Summary
Add E2E tests for the complete onboarding flow.

## Files
- `cli/commands/init/init-e2e.test.ts` (new)

## Checklist
- [ ] Test: create in current folder with minimal template
- [ ] Test: create in new folder with chat template
- [ ] Test: git init works
- [ ] Test: deps install works
- [ ] Test: `--yes` flag accepts all defaults
- [ ] Test: non-interactive mode with all flags

## Quality Gates
- [ ] All E2E tests pass
- [ ] Tests run in CI
- [ ] No flaky tests
