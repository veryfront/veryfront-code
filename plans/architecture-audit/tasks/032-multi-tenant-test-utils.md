# 032 - Multi-Tenant Test Utilities

## Priority: P2 - QUALITY

## North Star
Easy-to-use test utilities for verifying multi-tenant isolation.

## References
- Issue: [015.2-missing-multi-tenant-test-utilities.md](../015.2-missing-multi-tenant-test-utilities.md)
- RFC: [015.0-testability-rfc.md](../015.0-testability-rfc.md)

## Utilities to Create

```typescript
// Run concurrent requests for different projects
await withConcurrentTenants(
  { projectA: renderPage("/home") },
  { projectB: renderPage("/home") },
);

// Verify no cross-contamination
await verifyConcurrentIsolation(
  async (projectId) => renderWithContext(projectId, "/page"),
  ["project-a", "project-b", "project-c"],
);

// Create isolated test context
const ctx = createTestRequestContext({ projectId: "test-project" });
```

## Checklist
- [ ] Create `withConcurrentTenants()` test helper
- [ ] Create `verifyConcurrentIsolation()` assertion
- [ ] Create `createTestRequestContext()` factory
- [ ] Create mock adapters for each adapter type
- [ ] Add test isolation helpers (reset state between tests)
- [ ] Document test patterns in `tests/README.md`

## Acceptance Criteria
- [ ] Concurrent isolation testable with one-liner
- [ ] Test context created without global side effects
- [ ] All adapters mockable for unit tests
- [ ] Test utilities documented with examples

## Quality Gates
- [ ] Multi-tenant test in CI for critical paths
- [ ] Test utilities used in actual tests
- [ ] No flaky concurrent tests

## Test Coverage
- [ ] Meta: Test utilities themselves tested
- [ ] Usage: Head collector isolation test using utilities
- [ ] Usage: Config isolation test using utilities
