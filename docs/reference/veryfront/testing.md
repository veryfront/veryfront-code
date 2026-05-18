---
title: "veryfront/testing"
description: "Cross-runtime test utilities — BDD framework (describe/it), assertions, test isolation, filesystem/env helpers, and timing utilities for Deno, Node, and Bun."
order: 26
---

# veryfront/testing

Cross-runtime test utilities — BDD framework (describe/it), assertions, test isolation, filesystem/env helpers, and timing utilities for Deno, Node, and Bun.

## Import

```ts
import {
  afterAll,
  afterEach,
  assert,
  assertEquals,
  assertExists,
  assertGreater,
} from "veryfront/testing";
```

## Examples

```ts
import { assertEquals, describe, it } from "veryfront/testing";

describe("math", () => {
  it("adds numbers", () => {
    assertEquals(1 + 1, 2);
  });
});
```

## Exports

### Functions

| Name | Description |
|------|-------------|
| `afterAll` |  |
| `afterEach` |  |
| `assert` |  |
| `assertEquals` |  |
| `assertExists` |  |
| `assertGreater` |  |
| `assertGreaterOrEqual` |  |
| `assertInstanceOf` |  |
| `assertLess` |  |
| `assertLessOrEqual` |  |
| `assertMatch` |  |
| `assertNotEquals` |  |
| `assertNotStrictEquals` |  |
| `assertObjectMatch` |  |
| `assertRejects` |  |
| `assertStrictEquals` |  |
| `assertStringIncludes` |  |
| `assertThrows` |  |
| `beforeAll` |  |
| `beforeEach` |  |
| `chmod` |  |
| `createFileSystem` |  |
| `cwd` |  |
| `deepEquals` | ********************* |
| `delay` |  |
| `deleteEnv` |  |
| `describe` |  |
| `env` |  |
| `exists` |  |
| `exit` |  |
| `fail` |  |
| `getArgs` | Get command-line arguments (cross-runtime: Deno.args or process.argv). |
| `getEnv` |  |
| `getTestTimeScale` |  |
| `isAlreadyExistsError` |  |
| `isNotFoundError` |  |
| `it` |  |
| `makeTempDir` |  |
| `makeTempDirWithOptions` |  |
| `makeTempFile` |  |
| `mkdir` |  |
| `readDir` |  |
| `readFile` |  |
| `readTextFile` |  |
| `registerTestCleanup` |  |
| `remove` |  |
| `resetAllTestState` | Comprehensive reset of ALL test state across the application. |
| `safeStringify` |  |
| `scaleMs` |  |
| `setEnv` |  |
| `stat` |  |
| `testDelay` |  |
| `waitFor` |  |
| `withEnv` |  |
| `withTempDir` |  |
| `withTempFile` |  |
| `writeFile` |  |
| `writeTextFile` |  |

### Types

| Name | Description |
|------|-------------|
| `BddTestContext` | Context passed to hooks and tests (BDD-specific) |
| `TestOptions` | Test options for Deno sanitizers (ignored in Node/Bun) |

### Constants

| Name | Description |
|------|-------------|
| `isBun` | True if running in Bun runtime (check first since Bun has process.versions.node) |
| `isDeno` | True if running in real Deno runtime (not dnt shim) |
| `isNode` | True if running in Node.js runtime (has process.versions.node, not Bun, not shimmed Deno) |
| `test` |  |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/testing/assert`

```ts
import { assert, assertEquals, assertExists } from "veryfront/testing/assert";
```

#### Functions

| Name | Description |
|------|-------------|
| `assert` |  |
| `assertEquals` |  |
| `assertExists` |  |
| `assertGreater` |  |
| `assertGreaterOrEqual` |  |
| `assertInstanceOf` |  |
| `assertLess` |  |
| `assertLessOrEqual` |  |
| `assertMatch` |  |
| `assertNotEquals` |  |
| `assertNotStrictEquals` |  |
| `assertObjectMatch` |  |
| `assertRejects` |  |
| `assertStrictEquals` |  |
| `assertStringIncludes` |  |
| `assertThrows` |  |
| `fail` |  |

#### Types

| Name | Description |
|------|-------------|
| `ErrorClass` |  |

### `veryfront/testing/bdd`

Portable BDD testing utilities (describe, it, beforeEach, afterEach). In Deno: Direct re-export from @std/testing/bdd (no wrapper) In Node.js: Uses node:test In Bun: Uses bun:test

```ts
import { afterAll, afterEach, beforeAll } from "veryfront/testing/bdd";
```

#### Functions

| Name | Description |
|------|-------------|
| `afterAll` |  |
| `afterEach` |  |
| `beforeAll` |  |
| `beforeEach` |  |
| `describe` |  |
| `initBdd` |  |
| `it` |  |

#### Types

| Name | Description |
|------|-------------|
| `BddTestContext` | Context passed to hooks and tests (BDD-specific) |
| `HookFn` | Hook function |
| `TestFn` | Test function that can be sync or async |
| `TestOptions` | Test options for Deno sanitizers (ignored in Node/Bun) |

#### Constants

| Name | Description |
|------|-------------|
| `test` |  |

## Related

User guides:

- [extension-testing](../../guides/extension-testing.md): Test extensions with BDD utilities
