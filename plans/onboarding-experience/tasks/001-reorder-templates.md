# 001: Reorder Templates

## Summary
Reorder template catalog: minimal first, then progressively complex options.

## File
`cli/commands/init/catalog.ts`

## Checklist
- [ ] Move minimal to first position
- [ ] Order: minimal → chat → rag → multi-agent → workflow → coding-agent → saas
- [ ] Update any tests that depend on template order

## Quality Gates
- [ ] `deno task test:unit` passes
- [ ] `deno task lint` passes
- [ ] Manual test: `veryfront init` shows minimal first
