# 002: Location Prompt

## Summary
Add prompt asking user to create in current folder or new folder. If new folder, prompt for project name.

## Files
- `cli/commands/init/interactive-wizard.ts`
- `cli/commands/init/interactive-wizard.test.ts`

## Checklist
- [ ] Add `promptLocation()` function
- [ ] Options: "Current folder (.)" or "New folder"
- [ ] If new folder selected, prompt for project name
- [ ] Validate project name (no spaces, valid npm name)
- [ ] Return `{ location: 'current' | 'new', projectName?: string }`

## Quality Gates
- [ ] Unit tests for `promptLocation()`
- [ ] Unit tests for project name validation
- [ ] `deno task test:unit` passes
- [ ] `deno task lint` passes
- [ ] Manual test: both paths work correctly
