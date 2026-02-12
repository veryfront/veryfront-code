# 005: Package Manager Detection

## Summary
Detect which package manager invoked the command via `npm_config_user_agent`.

## Files
- `cli/utils/package-manager.ts` (new)
- `cli/utils/package-manager.test.ts` (new)

## Checklist
- [ ] Create `detectPackageManager()` function
- [ ] Parse `npm_config_user_agent` env var
- [ ] Return: `'npm' | 'pnpm' | 'yarn' | 'bun'`
- [ ] Fallback to `'npm'` if not detected
- [ ] Create `getRunCommand(pm)` → returns `npm run` / `pnpm` / `yarn` / `bun`
- [ ] Create `getDevCommand(pm)` → returns full dev command

## Quality Gates
- [ ] Unit tests for all package managers
- [ ] Unit tests for fallback behavior
- [ ] `deno task test:unit` passes
- [ ] `deno task lint` passes
