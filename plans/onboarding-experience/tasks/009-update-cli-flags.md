# 009: Update CLI Flags

## Summary
Update CLI argument schema and help for new options.

## Files
- `cli/commands/init/command.ts` (schema)
- `cli/commands/init/command-help.ts`

## Checklist
- [ ] Add `--no-git` flag to schema
- [ ] Update `--template` default to `minimal`
- [ ] Remove `--integrations` from prominent help (keep for power users)
- [ ] Update examples in help text
- [ ] Update template list order in help

## Quality Gates
- [ ] Schema tests pass
- [ ] `deno task test:unit` passes
- [ ] `deno task lint` passes
- [ ] `veryfront init --help` shows correct info
