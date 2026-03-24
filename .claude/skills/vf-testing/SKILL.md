---
name: vf-testing
description: Use when writing, modifying, or debugging tests in veryfront - covers BDD structure, deno test flags, test utilities, sanitizer rules, and test file placement
---

# Veryfront Testing Patterns

## Overview

Veryfront uses Deno's test runner with BDD-style tests. Tests are either colocated unit tests or separate integration tests.

**Core principle:** Tests must be self-contained, use proper cleanup, and never share state.

## Test Command

```bash
# Unit tests (colocated in src/)
VF_DISABLE_LRU_INTERVAL=1 SSR_TRANSFORM_PER_PROJECT_LIMIT=0 REVALIDATION_PER_PROJECT_LIMIT=0 NODE_ENV=production LOG_FORMAT=text deno test --no-check --allow-all --unstable-worker-options --unstable-net --parallel '--ignore=tests,src/ai/workflow/__tests__,src/cli/commands/*.integration.test.ts'

# All tests (unit + integration)
VF_DISABLE_LRU_INTERVAL=1 SSR_TRANSFORM_PER_PROJECT_LIMIT=0 REVALIDATION_PER_PROJECT_LIMIT=0 NODE_ENV=production LOG_FORMAT=text deno test --no-check --allow-all --unstable-worker-options --unstable-net

# Or use deno tasks
deno task test:unit
deno task test:integration
deno task test
```

## File Placement

| Type | Location | When |
|------|----------|------|
| Unit test | `src/module/name.test.ts` | Pure functions, no I/O, no server |
| Integration test | `tests/integration/feature/name.test.ts` | Needs TestContext, server, filesystem |
| E2E test | `tests/e2e/` | Full user flows (Playwright) |
| Index export test | `src/module/index.test.ts` | Verifies public API exports |

## Test Structure (BDD)

```typescript
import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertThrows, assertRejects } from "#veryfront/testing/assert";

describe("ComponentName", () => {
  describe("methodName", () => {
    it("should return expected result when given valid input", () => {
      // Arrange
      const input = createInput();

      // Act
      const result = method(input);

      // Assert
      assertEquals(result, expected, "descriptive message");
    });
  });
});
```

## Test Utilities

```typescript
// Resource management (integration tests)
import { withTestContext } from "#veryfront/testing";

// TestContext provides:
// - context.allocatePort() — no hard-coded ports
// - context.createServer() — managed server lifecycle
// - Automatic cleanup on test end

// Filesystem isolation
import { withTempDir, withTempFile } from "#veryfront/testing";

// Environment isolation
import { withEnv } from "#veryfront/testing";

// Async helpers
import { delay, waitFor } from "#veryfront/testing";

// Cleanup registration
import { registerTestCleanup } from "#veryfront/testing";
```

## Sanitizer Rules

Deno sanitizers are **enabled by default**. Only disable when documented:

```typescript
// ONLY for React 19 SSR tests (known MessagePort limitation)
it({
  name: "should render SSR stream",
  fn: async () => { /* ... */ },
  sanitizeResources: false,
  sanitizeOps: false,
});
```

Never disable sanitizers for convenience. If a test leaks resources, fix the leak.

## Index Export Tests

Every module's `index.test.ts` verifies the public API:

```typescript
import * as mod from "./index.ts";

describe("module/index", () => {
  it("should export expected API", () => {
    // Functions (from registry, use typeof === "object" for registry constants)
    assertEquals(typeof mod.CONFIG_NOT_FOUND, "object");

    // Types are verified by TypeScript, not runtime
  });
});
```

When migrating error classes to registry: change `typeof X === "function"` to `typeof X === "object"`.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Using `npx tsx --test` | Use `deno test` with proper flags |
| Hard-coded port numbers | Use `context.allocatePort()` |
| Arbitrary `setTimeout` waits | Use `waitFor()` with conditions |
| Shared mutable state between tests | Each test sets up its own state |
| Missing assertion messages | Always include descriptive messages |
| `import from "../../../"` | Use `#veryfront/` hash imports |
| Forgetting env vars | Use the full env var prefix from test command |
