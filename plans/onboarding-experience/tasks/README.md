# Onboarding Experience Tasks

Ordered implementation tasks for slick `pnpm create veryfront` experience.

## Task Order

| # | Task | Summary | Est |
|---|------|---------|-----|
| 001 | [Reorder Templates](./001-reorder-templates.md) | Minimal first, simple → complex | S |
| 002 | [Location Prompt](./002-location-prompt.md) | Current folder vs new folder | M |
| 003 | [Git Init Prompt](./003-git-init-prompt.md) | Add git initialization option | M |
| 004 | [Remove Integrations](./004-remove-integrations-prompt.md) | Simplify wizard flow | S |
| 005 | [Package Manager Detection](./005-package-manager-detection.md) | Detect npm/pnpm/yarn/bun | M |
| 006 | [Progress Output](./006-progress-output.md) | Branded spinners during creation | M |
| 007 | [Success Box](./007-success-box.md) | Next steps with correct commands | M |
| 008 | [Wire Up Wizard](./008-wire-up-wizard.md) | Integrate all components | L |
| 009 | [Update CLI Flags](./009-update-cli-flags.md) | Schema and help updates | S |
| 010 | [Update Docs](./010-update-docs.md) | README and help text | S |
| 011 | [E2E Tests](./011-e2e-tests.md) | Full flow integration tests | M |

**Size**: S = Small (< 1hr), M = Medium (1-2hr), L = Large (2-4hr)

## Dependencies

```
001 ─┐
002 ─┼─► 008 ─► 009 ─► 010
003 ─┤         │
004 ─┤         ▼
005 ─┤        011
006 ─┤
007 ─┘
```

## Quality Gates (All Tasks)

- [ ] `deno task test:unit` passes
- [ ] `deno task lint` passes
- [ ] `deno task typecheck` passes
- [ ] Code reviewed
- [ ] Manual testing completed

## How to Work on Tasks

1. Create branch: `git checkout -b feat/onboarding-{task-number}`
2. Implement changes per task checklist
3. Write/update tests
4. Run quality gates
5. Create PR referencing task
6. Get review and merge
