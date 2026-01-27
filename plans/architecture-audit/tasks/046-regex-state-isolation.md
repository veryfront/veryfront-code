# 046 - Global Regex State Isolation

## Priority: P1 - STABILITY

## North Star
No shared mutable regex state. Concurrent operations isolated.

## References
- Issue: [017.2-global-regex-state.md](../017.2-global-regex-state.md)

## The Problem

Global regex with `/g` flag shares `lastIndex` state across concurrent calls, corrupting results.

## Checklist
- [ ] Audit all module-level regex with `/g`
- [ ] Move regex inside functions OR
- [ ] Use `matchAll()` instead of `exec()` loop
- [ ] Add concurrent extraction tests
- [ ] Consider ESLint rule for global /g regex

## Acceptance Criteria
- [ ] No module-level regex with `/g` flag
- [ ] Concurrent regex operations return correct results
- [ ] Performance not degraded

## Quality Gates
- [ ] Concurrent extraction test passes
- [ ] No regex state leakage
- [ ] Performance within 10% of original

## Test Coverage
- [ ] Unit: Single call returns correct matches
- [ ] Unit: Concurrent calls all return correct matches
- [ ] Unit: Large input handling
- [ ] Integration: Import extraction under load

## Implementation Options

```typescript
// Option A: New regex per call
function extractImports(code: string): string[] {
  const regex = /import\s+.*?from\s+['"]([^'"]+)['"]/g;
  return [...code.matchAll(regex)].map(m => m[1]);
}

// Option B: Non-global with manual iteration
function extractImports(code: string): string[] {
  const regex = /import\s+.*?from\s+['"]([^'"]+)['"]/;
  const imports: string[] = [];
  let remaining = code;
  let match;
  while ((match = regex.exec(remaining))) {
    imports.push(match[1]);
    remaining = remaining.slice(match.index + match[0].length);
  }
  return imports;
}
```
