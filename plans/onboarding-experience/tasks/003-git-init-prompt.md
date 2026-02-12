# 003: Git Init Prompt

## Summary
Add prompt asking user if they want to initialize git. Implement git init after scaffolding.

## Files
- `cli/commands/init/interactive-wizard.ts`
- `cli/commands/init/init-command.ts`
- `cli/commands/init/init-command.test.ts`

## Checklist
- [ ] Add `promptGitInit()` function returning boolean
- [ ] Add `--no-git` CLI flag to skip
- [ ] Implement `initGit()` function: `git init && git add . && git commit -m "Initial commit"`
- [ ] Handle case where git is not installed
- [ ] Only init git if directory is not already a git repo

## Quality Gates
- [ ] Unit tests for `promptGitInit()`
- [ ] Unit tests for `initGit()` (mock git commands)
- [ ] `deno task test:unit` passes
- [ ] `deno task lint` passes
- [ ] Manual test: git repo created with initial commit
