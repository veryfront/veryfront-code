# Veryfront Test Style Guide

## Overview

This guide establishes conventions for writing maintainable, reliable, and
self-documenting tests in the Veryfront codebase. All tests should follow these
guidelines to ensure consistency and prevent technical debt.

## Test Organization

### File Structure

```
src/                      # Source code with colocated unit tests
├── module/
│   ├── function.ts
│   └── function.test.ts  # Unit test colocated with source

tests/
├── _helpers/             # Shared test utilities (TestContext, etc.)
├── _examples/            # Example tests demonstrating best practices
├── fixtures/             # Test data and mock implementations
└── integration/          # Integration tests (multiple components, I/O, servers)
```

**Key Principles:**

- **Unit tests** (pure functions, no I/O, no external dependencies) are **colocated** with source code in `src/`
- **Integration tests** (servers, databases, file systems, multiple components) live in `tests/integration/`
- No separate `e2e/` directory yet - add when needed for full end-to-end user flows

### File Naming

- **Unit tests** (colocated): `src/module/[name].test.ts`
- **Integration tests**: `tests/integration/[feature]/[name].test.ts`
- Never use: `_test.ts`, `_more_test.ts`, `_comprehensive_test.ts`

### When to Use Each Type

**Colocated Unit Tests (`src/`):**

- Pure functions with deterministic output
- Classes/modules with no external dependencies
- No file system, network, or database access
- Fast execution (<100ms per test)
- Example: String manipulation, data transformation, validation logic

**Integration Tests (`tests/integration/`):**

- Tests requiring TestContext and dev/production servers
- File system operations
- Network requests
- Database interactions
- Multiple components working together
- React SSR/streaming tests
- Example: API endpoints, page rendering, build processes

## Test Structure

### Use BDD Style

```typescript
import { describe, it } from "std/testing/bdd.ts";

describe("ComponentName", () => {
  describe("methodName", () => {
    it("should perform expected behavior when given specific input", async () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
```

### Test Naming Conventions

**Write self-documenting test names:**

✅ **Good:**

- `"should return user data when valid ID is provided"`
- `"should throw ValidationError when email format is invalid"`
- `"handles 404 for missing files"`

❌ **Bad:**

- `"test user"` - too vague
- `"works"` - no context
- `"test1"` - meaningless

**The test name should explain what's being tested. Additional documentation is rarely needed.**

## Resource Management

### Use TestContext for Integration Tests

For integration tests in `tests/integration/`, always use TestContext:

```typescript
import { withTestContext } from "../../_helpers/context.ts";

it("should test server behavior", async () => {
  await withTestContext("my-test", async (context) => {
    const server = await context.startDevServer();
    // Test implementation
    // Cleanup is automatic
  });
});
```

### Colocated Unit Tests Don't Need TestContext

Unit tests colocated with source code are simple and fast:

```typescript
import { assertEquals } from "std/assert/mod.ts";
import { describe, it } from "std/testing/bdd.ts";
import { myFunction } from "./my-function.ts";

describe("myFunction", () => {
  it("should return correct result", () => {
    const result = myFunction("input");
    assertEquals(result, "expected");
  });
});
```

### Resource Sanitization

**Default Rule: Always enable sanitizers**

✅ **Preferred - Clean resource management:**

```typescript
Deno.test("my test", async () => {
  await withTestContext("my-test", async (context) => {
    // Test implementation with automatic cleanup
  });
});
```

**Exception: React 19 SSR Tests**

React 19's server-side rendering implementation uses MessagePorts internally,
which requires disabling sanitizers. This is a known limitation of the React DOM
Server, not a bug in your code.

✅ **Acceptable for React SSR tests only:**

```typescript
describe("SSR/MDX Tests", {
  // React 19's SSR uses MessagePorts internally which causes leak detection
  // This is a known issue with React DOM Server and not a bug in our code
  sanitizeResources: false,
  sanitizeOps: false,
}, () => {
  it("should render MDX content", async () => {
    await withTestContext("mdx-test", async (context) => {
      // Test implementation
    });
  });
});
```

❌ **Wrong - Disabling sanitizers without justification:**

```typescript
Deno.test({
  name: "my test",
  sanitizeResources: false, // Don't do this without React SSR
  sanitizeOps: false,
  fn: async () => {/* ... */},
});
```

**Guidelines:**

1. Only disable sanitizers for tests involving React SSR/streaming
2. Always document why sanitizers are disabled
3. Place the flags at the describe block level, not individual tests
4. Still use TestContext for proper cleanup even with disabled sanitizers

## Assertions

### Use Meaningful Assertions

❌ **Wrong:**

```typescript
assert(response.status === 200 || response.status === 404);
assertEquals(users.length > 0, true);
```

✅ **Right:**

```typescript
assertEquals(
  response.status,
  200,
  "Profile endpoint should return 200 for authenticated users",
);
assertExists(users.length, "Should return at least one user for admin query");
```

### Assertion Messages

Always include a descriptive message explaining what the assertion verifies:

```typescript
assertEquals(
  response.headers.get("content-type"),
  "application/json",
  "API endpoints should always return JSON content-type",
);
```

## Avoiding Flakiness

### No Arbitrary Timeouts

❌ **Wrong:**

```typescript
await new Promise((resolve) => setTimeout(resolve, 500)); // Magic number!
```

✅ **Right:**

```typescript
await context.waitForServerReady(server); // Event-based waiting
```

### No Hard-Coded Ports

❌ **Wrong:**

```typescript
const server = await startServer({ port: 3000 });
```

✅ **Right:**

```typescript
const port = await context.allocatePort();
const server = await startServer({ port });
```

### Proper Async Handling

```typescript
// Always use try-finally for cleanup
const resource = await createResource();
try {
  await testWithResource(resource);
} finally {
  await resource.cleanup();
}
```

## Test Data

### Use Factories

```typescript
class UserFactory {
  static create(overrides: Partial<User> = {}): User {
    return {
      id: crypto.randomUUID(),
      name: "Test User",
      email: "test@example.com",
      createdAt: new Date(),
      ...overrides,
    };
  }
}

// Usage
const user = UserFactory.create({ name: "John Doe" });
```

### Avoid Test Interdependence

Each test must be completely independent:

```typescript
// ❌ Wrong: Depends on previous test state
it("should update user", async () => {
  const user = globalUser; // BAD: Relies on another test
});

// ✅ Right: Self-contained
it("should update user", async () => {
  const user = await createTestUser(); // Creates its own data
});
```

## Performance Testing

### Set Performance Budgets

```typescript
it("should respond within 100ms for cached requests", async () => {
  const start = performance.now();
  const response = await fetch(url);
  const duration = performance.now() - start;

  assert(
    duration < 100,
    `Response took ${duration.toFixed(2)}ms, exceeding 100ms budget`,
  );
});
```

## Error Testing

### Test Error Scenarios

```typescript
describe("Error Handling", () => {
  it("should return 400 for invalid input", async () => {
    const response = await fetch("/api/users", {
      method: "POST",
      body: JSON.stringify({ email: "invalid-email" }),
    });

    assertEquals(response.status, 400);
    const error = await response.json();
    assertEquals(error.code, "INVALID_EMAIL");
    assertExists(error.message);
  });
});
```

## Integration Testing

### Test Real Integrations

```typescript
describe("Redis Cache Integration", () => {
  it("should handle Redis connection failures gracefully", async () => {
    await withTestContext("redis-failure", async (context) => {
      // Simulate Redis being down
      context.setEnv({ REDIS_URL: "redis://invalid:6379" });

      const server = await context.createProductionServer();
      const response = await fetch(`http://localhost:${server.port}/api/data`);

      // Should fallback gracefully
      assertEquals(response.status, 200);
      assertEquals(
        response.headers.get("x-cache-status"),
        "bypass",
        "Should bypass cache when Redis is unavailable",
      );
    });
  });
});
```

## Common Patterns

### Testing Streaming Responses

```typescript
it("should stream response chunks", async () => {
  const response = await fetch(url);
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  assert(chunks.length > 1, "Should receive multiple chunks");
});
```

### Testing WebSocket Connections

```typescript
it("should handle WebSocket messages", async () => {
  const ws = new WebSocket(`ws://localhost:${port}`);
  const messages: string[] = [];

  try {
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
      ws.onmessage = (event) => messages.push(event.data);
    });

    ws.send("ping");

    // Wait for response with timeout
    await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 1000);
      ws.addEventListener("message", () => {
        clearTimeout(timeout);
        resolve(null);
      });
    });

    assertExists(messages.find((m) => m === "pong"));
  } finally {
    ws.close();
  }
});
```

## Debugging Tests

### Add Debug Output

```typescript
it("should process data correctly", async () => {
  const input = generateTestData();

  if (Deno.env.get("DEBUG_TESTS")) {
    console.log("Test input:", JSON.stringify(input, null, 2));
  }

  const result = await processData(input);

  if (Deno.env.get("DEBUG_TESTS")) {
    console.log("Test output:", JSON.stringify(result, null, 2));
  }

  assertEquals(result.status, "success");
});
```

## Test Maintenance

### Regular Review Checklist

- [ ] All tests pass without flakiness
- [ ] Unit tests are colocated with source code in `src/`
- [ ] Integration tests are in `tests/integration/`
- [ ] No disabled sanitizers (except documented React SSR cases)
- [ ] No arbitrary timeouts or magic numbers
- [ ] All assertions have descriptive messages
- [ ] No test interdependencies
- [ ] Proper resource cleanup
- [ ] Self-documenting test names
- [ ] TestContext used for integration tests requiring servers

## Migration Guide

### Moving Tests to Colocated Structure

To migrate existing tests to the colocated structure:

1. **Identify unit tests** - Look for tests with no I/O, no TestContext, no server
2. **Move to source directory** - Place `function.test.ts` next to `function.ts` in `src/`
3. **Update imports** - Change relative paths (e.g., `../../../src/` → `./`)
4. **Keep integration tests** - Tests using TestContext stay in `tests/integration/`

### Improving Test Quality

To improve existing tests:

1. Replace arbitrary timeouts with TestContext's event-based waiting
2. Enable sanitizers and fix resource leaks (except for React SSR tests)
3. Add meaningful assertion messages with context
4. Consolidate related test files
5. Use factories for test data
6. Ensure test independence
7. Use `withTestContext` for automatic cleanup in integration tests

## Example Migration

Before:

```typescript
Deno.test({
  name: "Production Build",
  sanitizeResources: false,
  fn: async () => {
    const dir = await Deno.makeTempDir();
    const port = 9999;

    // ... test code ...

    await new Promise((r) => setTimeout(r, 500));
    assert(response.status === 200);
  },
});
```

After:

```typescript
describe("Production Build", () => {
  it("should build and serve static assets correctly", async () => {
    await withTestContext("production-build", async (context) => {
      const server = await context.createProductionServer();
      const response = await fetch(
        `http://localhost:${server.port}/assets/style.css`,
      );

      assertEquals(
        response.status,
        200,
        "Built assets should be accessible via production server",
      );
      assertExists(
        response.headers.get("cache-control"),
        "Static assets should include cache headers",
      );
    });
  });
});
```
