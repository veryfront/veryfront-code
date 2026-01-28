# 043 - Path Traversal Validation

## Priority: P1 - SECURITY

## North Star
File operations validated against directory traversal. Projects isolated to their directories.

## References
- Issue: [016.4-path-traversal.md](../016.4-path-traversal.md)
- Related: [016-unified-adapter-interface.md](./016-unified-adapter-interface.md)

## The Problem

Path operations don't consistently validate against `../` traversal, allowing escape from project directories.

## Checklist
- [ ] Create `validatePath()` utility
- [ ] Add to all adapter read/write methods
- [ ] Handle URL encoding and Unicode normalization
- [ ] Add path traversal test suite
- [ ] Document security boundary

## Acceptance Criteria
- [ ] `../` paths rejected with clear error
- [ ] URL-encoded traversal blocked (`%2F%2E%2E`)
- [ ] Symbolic links don't escape boundary
- [ ] Error messages don't leak path info

## Quality Gates
- [ ] Traversal attempt returns 403/400
- [ ] Legitimate relative paths still work
- [ ] No path leakage in error responses

## Test Coverage
- [ ] Unit: Simple traversal blocked
- [ ] Unit: Encoded traversal blocked
- [ ] Unit: Deeply nested traversal blocked
- [ ] Unit: Legitimate paths allowed
- [ ] Integration: Adapter rejects invalid paths

## Decision Required

**D011**: Path validation approach:
- A) Centralized utility (all adapters call it)
- B) Per-adapter (each implements own)
- C) Middleware (validate before adapter)
