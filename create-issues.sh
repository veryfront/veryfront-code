#!/bin/bash

# Script to create GitHub issues from code review
# Since gh CLI is not available, this provides the curl commands

REPO_OWNER="veryfront"
REPO_NAME="veryfront-private"

echo "GitHub Issues to Create"
echo "========================"
echo ""
echo "Visit: https://github.com/${REPO_OWNER}/${REPO_NAME}/issues/new"
echo ""
echo "Or run these commands if you have a GitHub token:"
echo ""

cat << 'EOF'
# Issue 1: [P0] Fix race condition in dev-server virtual module test
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/veryfront/veryfront-private/issues \
  -d '{
    "title": "[P0] Fix race condition in dev-server virtual module test",
    "body": "## Description\n\nThere is a known race condition in the virtual module test that causes flaky test failures.\n\n## Location\n`tests/integration/server/dev-server.test.ts:676`\n\n## Details\n```typescript\n// FIXME: Virtual module test has async initialization race condition\n```\n\n## Impact\nTest reliability, blocks release\n\n## Acceptance Criteria\n- [ ] Race condition identified and fixed\n- [ ] Test passes consistently (100 runs without failure)\n- [ ] Root cause documented",
    "labels": ["bug", "testing", "P0"]
  }'

# Issue 2: [P0] Add rate limiting for API and AI endpoints
echo "✅ FIXED - PR created: claude/add-rate-limiting-middleware-015C6ayHyE5n5m34PavrKhia"

# Issue 3: [P1] Replace console statements with proper logger
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/veryfront/veryfront-private/issues \
  -d '{
    "title": "[P1] Replace console statements with proper logger (168 instances)",
    "body": "## Description\n\nThe codebase contains 168 console statements across 44 files, preventing proper log level control and structured logging in production.\n\n## Findings\n- `console.log`: Debug output\n- `console.error`: Error handling\n- `console.warn`: Warnings\n\n## Files with highest usage\n- `src/server/dev-server/hmr/templates.ts`\n- `src/html/hydration-script-builder/`\n- `src/build/bundler/code-splitter/splitter.ts`\n\n## Impact\n- Cannot control log levels in production\n- No structured logging for monitoring\n- Performance impact\n\n## Acceptance Criteria\n- [ ] Replace all console.* with logger\n- [ ] Exceptions: client-side templates (documented)\n- [ ] Update lint rules to enforce\n- [ ] Tests pass\n- [ ] Documentation updated",
    "labels": ["code-quality", "refactor", "P1"]
  }'

# Issue 4: [P1] Reduce TypeScript any usage
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/veryfront/veryfront-private/issues \
  -d '{
    "title": "[P1] Reduce TypeScript any usage (406 instances across 52 files)",
    "body": "## Description\n\nThere are 406 instances of `any` type across 52 files, contradicting the \"TypeScript First\" and \"End-to-end type safety\" goals.\n\n## Impact\n- Loses TypeScript benefits\n- Runtime errors not caught at compile time\n- Poor IDE support\n\n## Strategy\n1. Replace with `unknown` for truly unknown data\n2. Use generics for reusable code\n3. Create specific union types\n4. Document legitimate uses with `@ts-expect-error`\n\n## Acceptance Criteria\n- [ ] Reduce `any` usage by 50% (to ~200 instances)\n- [ ] Focus on runtime-critical files first\n- [ ] Add proper types for provider interfaces\n- [ ] Document remaining `any` usage\n- [ ] Tests pass with stricter types",
    "labels": ["typescript", "type-safety", "P1"]
  }'

# Issue 5: [P1] Increase test coverage to 40%
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/veryfront/veryfront-private/issues \
  -d '{
    "title": "[P1] Increase test coverage to 40%",
    "body": "## Description\n\nCurrenttest coverage is only 8.3% (79 test files / 947 total files), which is insufficient for production readiness.\n\n## Current Status\n- Total TypeScript files: 947\n- Test files: 79\n- Coverage: ~8.3%\n\n## Priority Testing Areas\n1. Security-critical code (path validation, input sanitization)\n2. AI agent error scenarios\n3. Streaming error recovery\n4. Platform adapter implementations\n5. Build pipeline failures\n\n## Acceptance Criteria\n- [ ] Test coverage reaches 40%\n- [ ] All security-critical paths have tests\n- [ ] Error handling scenarios tested\n- [ ] Integration tests for core workflows\n- [ ] Coverage tracked in CI",
    "labels": ["testing", "quality", "P1"]
  }'

# Issue 6: [P2] Integrate SecureFs in build pipeline
echo "✅ FIXED - PR created: claude/fix-secure-fs-build-pipeline-015C6ayHyE5n5m34PavrKhia"

# Issue 7: [P2] Enable stricter TypeScript compiler options
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/veryfront/veryfront-private/issues \
  -d '{
    "title": "[P2] Enable stricter TypeScript compiler options",
    "body": "## Description\n\nAdditional TypeScript strict flags should be enabled to catch more errors at compile time.\n\n## Proposed Flags\n```json\n{\n  \"noUnusedLocals\": true,\n  \"noUnusedParameters\": true,\n  \"noImplicitReturns\": true,\n  \"noFallthroughCasesInSwitch\": true\n}\n```\n\n## Acceptance Criteria\n- [ ] Enable recommended strict flags\n- [ ] Fix resulting compilation errors\n- [ ] Update code to pass new checks\n- [ ] Document any exceptions",
    "labels": ["typescript", "quality", "P2"]
  }'

# Issue 8: [P2] Add security event logging by default
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/veryfront/veryfront-private/issues \
  -d '{
    "title": "[P2] Add security event logging by default",
    "body": "## Description\n\nThe SecureFs security event callback defaults to a no-op function, meaning security events are not logged by default.\n\n## Location\n`src/security/secure-fs.ts:138`\n\n## Current Behavior\n```typescript\nonSecurityEvent: () => {}, // No-op by default\n```\n\n## Acceptance Criteria\n- [ ] Log security events by default\n- [ ] Use structured logging\n- [ ] Configurable log levels\n- [ ] Include relevant context (path, operation, error)\n- [ ] Tests for security logging",
    "labels": ["security", "observability", "P2"]
  }'

# Issue 9: [P3] Add performance benchmarks
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/veryfront/veryfront-private/issues \
  -d '{
    "title": "[P3] Add performance benchmarks",
    "body": "## Description\n\nNo performance benchmarks exist to track performance characteristics and regressions.\n\n## Proposed Benchmarks\n1. Path validation performance\n2. CSS optimization speed\n3. Agent runtime latency\n4. Memory usage patterns\n5. Build time metrics\n\n## Acceptance Criteria\n- [ ] Benchmark suite created\n- [ ] Baseline metrics established\n- [ ] CI integration for regression detection\n- [ ] Performance documentation",
    "labels": ["performance", "testing", "P3"]
  }'

# Issue 10: [P3] Improve error messages and developer experience
curl -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/veryfront/veryfront-private/issues \
  -d '{
    "title": "[P3] Improve error messages and developer experience",
    "body": "## Description\n\nError messages could be more helpful for developers debugging issues.\n\n## Examples\n- Generic \"Invalid path\" errors without context\n- Missing suggestions for common mistakes\n- Limited error recovery guidance\n\n## Acceptance Criteria\n- [ ] Audit existing error messages\n- [ ] Add helpful context and suggestions\n- [ ] Include error codes for documentation links\n- [ ] Add development mode warnings\n- [ ] User testing for error message clarity",
    "labels": ["dx", "enhancement", "P3"]
  }'

EOF

echo ""
echo "========================"
echo "Summary:"
echo "- Issue 2 (Rate Limiting): ✅ FIXED"
echo "- Issue 6 (SecureFs): ✅ FIXED"
echo "- 8 issues need to be created"
