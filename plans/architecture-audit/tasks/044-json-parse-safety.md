# 044 - Safe JSON.parse Wrapper

## Priority: P1 - SECURITY

## North Star
Malformed JSON handled gracefully. No uncaught exceptions from parse failures.

## References
- Issue: [016.5-json-parse-validation.md](../016.5-json-parse-validation.md)
- Related: [024-error-handling-patterns.md](./024-error-handling-patterns.md)

## The Problem

40+ `JSON.parse()` calls without try/catch. Malformed input crashes request handlers.

## Checklist
- [ ] Create `safeJsonParse<T>()` utility
- [ ] Return `Result<T, Error>` type
- [ ] Audit all `JSON.parse` calls
- [ ] Replace with safe version
- [ ] Add optional schema validation
- [ ] Add malformed input tests

## Acceptance Criteria
- [ ] No `JSON.parse` without error handling
- [ ] Malformed JSON returns error, doesn't crash
- [ ] Clear error messages for debugging

## Quality Gates
- [ ] Malformed JSON test suite passes
- [ ] No uncaught exceptions from parse
- [ ] Performance overhead < 1ms

## Test Coverage
- [ ] Unit: Valid JSON parsed correctly
- [ ] Unit: Invalid JSON returns error
- [ ] Unit: Empty string returns error
- [ ] Unit: Null byte handling
- [ ] Integration: API handles malformed responses

## Implementation

```typescript
interface ParseResult<T> {
  ok: true;
  value: T;
} | {
  ok: false;
  error: Error;
}

function safeJsonParse<T>(input: string): ParseResult<T>;
```
