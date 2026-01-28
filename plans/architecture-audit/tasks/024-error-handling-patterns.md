# 024 - Error Handling Patterns

## Priority: P4 - MAINTENANCE

## North Star
Consistent error handling. No silent failures. All errors logged and typed.

## References
- Issues: [010.4](../010.4-witherrorcontext-silent-failures.md), [010.5](../010.5-wraperror-stack-trace-loss.md), [010.6](../010.6-inconsistent-500-responses.md)
- RFC: [010.0-error-handling-rfc.md](../010.0-error-handling-rfc.md)

## Checklist
- [ ] Create `VeryfrontError` base class with error codes
- [ ] Use ES2022 `Error.cause` for wrapping
- [ ] Remove `withErrorContext` silent swallowing
- [ ] Standardize 500 response format (HTML with error page)
- [ ] Add structured logging for all errors
- [ ] Ensure stack traces preserved through wrapping

## Acceptance Criteria
- [ ] No silent `catch` blocks (all log or rethrow)
- [ ] Stack trace preserved from original error
- [ ] 500 responses consistent (HTML error page)
- [ ] All errors have error code and context

## Quality Gates
- [ ] `grep -r "catch.*{}" src/` returns 0 (no empty catch)
- [ ] All errors extend VeryfrontError
- [ ] Production errors have error codes for debugging

## Test Coverage
- [ ] Unit: Error wrapping preserves cause chain
- [ ] Unit: Stack trace accessible from wrapped error
- [ ] Integration: 500 response renders error page
- [ ] Integration: Error code in production response
