# GitHub Issues for Code Review Findings

Create these issues on GitHub from the code review findings:

---

## Issue 1: [P0] Fix race condition in dev-server virtual module test

**Labels:** `bug`, `testing`, `P0`

**Description:**
There is a known race condition in the virtual module test that causes flaky test failures.

**Location:**
`tests/integration/server/dev-server.test.ts:676`

**Details:**
```typescript
// FIXME: Virtual module test has async initialization race condition
```

**Impact:** Test reliability, blocks release

**Acceptance Criteria:**
- [ ] Race condition identified and fixed
- [ ] Test passes consistently (100 runs without failure)
- [ ] Root cause documented

---

## Issue 2: [P0] Add rate limiting for API and AI endpoints

**Labels:** `security`, `enhancement`, `P0`

**Description:**
Currently there is no rate limiting implemented for API endpoints or AI operations, making the application vulnerable to DoS attacks and abuse.

**Impact:** Security vulnerability, resource exhaustion

**Proposed Solution:**
- Implement rate limiting middleware
- Support multiple strategies: token bucket, sliding window, fixed window
- Add rate limiting for:
  - API routes
  - AI agent operations
  - File uploads (if any)

**Acceptance Criteria:**
- [ ] Rate limiting middleware implemented
- [ ] Configurable limits per endpoint
- [ ] Proper error responses (429 Too Many Requests)
- [ ] Tests for rate limiting behavior
- [ ] Documentation updated

---

## Issue 3: [P1] Replace console statements with proper logger (168 instances)

**Labels:** `code-quality`, `refactor`, `P1`

**Description:**
The codebase contains 168 console statements across 44 files, which prevents proper log level control and structured logging in production.

**Findings:**
- `console.log`: Debug output
- `console.error`: Error handling
- `console.warn`: Warnings

**Files with highest usage:**
- `src/server/dev-server/hmr/templates.ts`
- `src/html/hydration-script-builder/`
- `src/build/bundler/code-splitter/splitter.ts`
- Many others

**Impact:**
- Cannot control log levels in production
- No structured logging for monitoring
- Performance impact

**Acceptance Criteria:**
- [ ] Replace all console.* with logger
- [ ] Exceptions: client-side templates (documented)
- [ ] Update lint rules to enforce
- [ ] Tests pass
- [ ] Documentation updated

---

## Issue 4: [P1] Reduce TypeScript 'any' usage (406 instances across 52 files)

**Labels:** `typescript`, `type-safety`, `P1`

**Description:**
There are 406 instances of `any` type across 52 files, contradicting the "TypeScript First" and "End-to-end type safety" goals.

**Impact:**
- Loses TypeScript benefits
- Runtime errors not caught at compile time
- Poor IDE support

**Strategy:**
1. Replace with `unknown` for truly unknown data
2. Use generics for reusable code
3. Create specific union types
4. Document legitimate uses with `@ts-expect-error`

**Acceptance Criteria:**
- [ ] Reduce `any` usage by 50% (to ~200 instances)
- [ ] Focus on runtime-critical files first
- [ ] Add proper types for provider interfaces
- [ ] Document remaining `any` usage
- [ ] Tests pass with stricter types

---

## Issue 5: [P1] Increase test coverage to 40%

**Labels:** `testing`, `quality`, `P1`

**Description:**
Current test coverage is only 8.3% (79 test files / 947 total files), which is insufficient for production readiness.

**Current Status:**
- Total TypeScript files: 947
- Test files: 79
- Coverage: ~8.3%

**Priority Testing Areas:**
1. Security-critical code (path validation, input sanitization)
2. AI agent error scenarios
3. Streaming error recovery
4. Platform adapter implementations
5. Build pipeline failures

**Acceptance Criteria:**
- [ ] Test coverage reaches 40%
- [ ] All security-critical paths have tests
- [ ] Error handling scenarios tested
- [ ] Integration tests for core workflows
- [ ] Coverage tracked in CI

---

## Issue 6: [P2] Integrate SecureFs in build pipeline

**Labels:** `security`, `build`, `P2`

**Description:**
The CSS optimizer service uses direct `Deno.readTextFile` and `Deno.writeTextFile` calls instead of using RuntimeAdapter and SecureFs.

**Location:**
- `src/build/asset-pipeline/css-optimizer/optimizer-service.ts:135, 166`

**Impact:**
- Breaks multi-runtime support promise
- Missing path validation
- Potential path traversal in build artifacts

**Acceptance Criteria:**
- [ ] Replace Deno-specific calls with RuntimeAdapter
- [ ] Integrate SecureFs for path validation
- [ ] Tests for path validation in build context
- [ ] Works on all supported runtimes

---

## Issue 7: [P2] Enable stricter TypeScript compiler options

**Labels:** `typescript`, `quality`, `P2`

**Description:**
Additional TypeScript strict flags should be enabled to catch more errors at compile time.

**Proposed Flags:**
```json
{
  "noUnusedLocals": true,
  "noUnusedParameters": true,
  "noImplicitReturns": true,
  "noFallthroughCasesInSwitch": true
}
```

**Acceptance Criteria:**
- [ ] Enable recommended strict flags
- [ ] Fix resulting compilation errors
- [ ] Update code to pass new checks
- [ ] Document any exceptions

---

## Issue 8: [P2] Add security event logging by default

**Labels:** `security`, `observability`, `P2`

**Description:**
The SecureFs security event callback defaults to a no-op function, meaning security events are not logged by default.

**Location:**
`src/security/secure-fs.ts:138`

**Current Behavior:**
```typescript
onSecurityEvent: () => {}, // No-op by default
```

**Acceptance Criteria:**
- [ ] Log security events by default
- [ ] Use structured logging
- [ ] Configurable log levels
- [ ] Include relevant context (path, operation, error)
- [ ] Tests for security logging

---

## Issue 9: [P3] Add performance benchmarks

**Labels:** `performance`, `testing`, `P3`

**Description:**
No performance benchmarks exist to track performance characteristics and regressions.

**Proposed Benchmarks:**
1. Path validation performance
2. CSS optimization speed
3. Agent runtime latency
4. Memory usage patterns
5. Build time metrics

**Acceptance Criteria:**
- [ ] Benchmark suite created
- [ ] Baseline metrics established
- [ ] CI integration for regression detection
- [ ] Performance documentation

---

## Issue 10: [P3] Improve error messages and developer experience

**Labels:** `dx`, `enhancement`, `P3`

**Description:**
Error messages could be more helpful for developers debugging issues.

**Examples:**
- Generic "Invalid path" errors without context
- Missing suggestions for common mistakes
- Limited error recovery guidance

**Acceptance Criteria:**
- [ ] Audit existing error messages
- [ ] Add helpful context and suggestions
- [ ] Include error codes for documentation links
- [ ] Add development mode warnings
- [ ] User testing for error message clarity

---

# Summary

**P0 (Critical):** 2 issues
**P1 (High):** 3 issues
**P2 (Medium):** 3 issues
**P3 (Low):** 2 issues

**Total:** 10 issues

Create these issues on GitHub and reference the full code review in `CODE_REVIEW.md`.
