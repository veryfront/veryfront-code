# 057 - Naming Convention Standardization

## Priority: P4 - CODE QUALITY

## North Star
Consistent naming throughout codebase. Reduced cognitive load.

## References
- Issue: [019.5-naming-inconsistencies.md](../019.5-naming-inconsistencies.md)

## The Problem

15 categories of naming inconsistencies: handler vs middleware, ctx vs context, boolean naming, etc.

## Checklist
- [ ] Create naming conventions document
- [ ] Define standards for each category
- [ ] Add to contributor guidelines
- [ ] Configure ESLint rules where possible
- [ ] Apply to new code immediately

## Categories to Standardize

| Category | Standard |
|----------|----------|
| Handler/Middleware | `middleware` for processing, `handler` for terminal |
| ctx/context | `ctx` for params, full name for types |
| Project IDs | Always `projectId` or `projectSlug` |
| Booleans | `is`, `has`, `should`, `can` prefix |
| Async functions | Don't suffix with `Async` |

## Acceptance Criteria
- [ ] Conventions documented
- [ ] ESLint rules configured
- [ ] New code follows conventions

## Quality Gates
- [ ] Documentation complete
- [ ] Linting catches violations
- [ ] Team trained on standards

## Decision Required

**D014**: Naming convention standard - specific choices for each category

## Migration Approach

- Don't mass rename (causes merge conflicts, git blame pollution)
- Apply to new code immediately
- Fix when touching existing code
- Use alias exports during transition
