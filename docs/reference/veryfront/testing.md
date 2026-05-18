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

| Name | Description | Source |
|------|-------------|--------|
| `afterAll` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L597) |
| `afterEach` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L581) |
| `assert` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L277) |
| `assertEquals` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L265) |
| `assertExists` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L281) |
| `assertGreater` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L336) |
| `assertGreaterOrEqual` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L340) |
| `assertInstanceOf` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L311) |
| `assertLess` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L344) |
| `assertLessOrEqual` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L348) |
| `assertMatch` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L307) |
| `assertNotEquals` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L269) |
| `assertNotStrictEquals` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L324) |
| `assertObjectMatch` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L328) |
| `assertRejects` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L294) |
| `assertStrictEquals` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L273) |
| `assertStringIncludes` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L303) |
| `assertThrows` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L285) |
| `beforeAll` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L589) |
| `beforeEach` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L573) |
| `chmod` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L311) |
| `createFileSystem` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L258) |
| `cwd` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L17) |
| `deepEquals` | ********************* Shared utility functions for cross-runtime testing. ********************* | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/utils.ts#L4) |
| `delay` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L118) |
| `deleteEnv` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L195) |
| `describe` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L462) |
| `env` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L30) |
| `exists` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L285) |
| `exit` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L122) |
| `fail` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L320) |
| `getArgs` | Get command-line arguments (cross-runtime: Deno.args or process.argv). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L4) |
| `getEnv` | Read an environment variable from the active project scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L102) |
| `getTestTimeScale` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L14) |
| `isAlreadyExistsError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L348) |
| `isNotFoundError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L335) |
| `it` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L516) |
| `makeTempDir` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L307) |
| `makeTempDirWithOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L70) |
| `makeTempFile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L46) |
| `mkdir` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L293) |
| `readDir` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L301) |
| `readFile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L273) |
| `readTextFile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L269) |
| `registerTestCleanup` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/isolation.ts#L20) |
| `remove` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L297) |
| `resetAllTestState` | Comprehensive reset of ALL test state across the application. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/isolation.ts#L62) |
| `safeStringify` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/utils.ts#L32) |
| `scaleMs` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L18) |
| `setEnv` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L177) |
| `stat` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L289) |
| `testDelay` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L23) |
| `waitFor` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L95) |
| `withEnv` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L177) |
| `withTempDir` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L131) |
| `withTempFile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L154) |
| `writeFile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L281) |
| `writeTextFile` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L277) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `BddTestContext` | Context passed to hooks and tests (BDD-specific) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L29) |
| `TestOptions` | Test options for Deno sanitizers (ignored in Node/Bun) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L18) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `isBun` | True if running in Bun runtime (check first since Bun has process.versions.node) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L54) |
| `isDeno` | True if running in real Deno runtime (not dnt shim) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L60) |
| `isNode` | True if running in Node.js runtime (has process.versions.node, not Bun, not shimmed Deno) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L57) |
| `test` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L605) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/testing/assert`

```ts
import { assert, assertEquals, assertExists } from "veryfront/testing/assert";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `assert` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L277) |
| `assertEquals` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L265) |
| `assertExists` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L281) |
| `assertGreater` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L336) |
| `assertGreaterOrEqual` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L340) |
| `assertInstanceOf` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L311) |
| `assertLess` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L344) |
| `assertLessOrEqual` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L348) |
| `assertMatch` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L307) |
| `assertNotEquals` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L269) |
| `assertNotStrictEquals` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L324) |
| `assertObjectMatch` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L328) |
| `assertRejects` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L294) |
| `assertStrictEquals` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L273) |
| `assertStringIncludes` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L303) |
| `assertThrows` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L285) |
| `fail` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L320) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ErrorClass` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L5) |

### `veryfront/testing/bdd`

Portable BDD testing utilities (describe, it, beforeEach, afterEach). In Deno: Direct re-export from @std/testing/bdd (no wrapper) In Node.js: Uses node:test In Bun: Uses bun:test

```ts
import { afterAll, afterEach, beforeAll } from "veryfront/testing/bdd";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `afterAll` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L597) |
| `afterEach` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L581) |
| `beforeAll` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L589) |
| `beforeEach` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L573) |
| `describe` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L462) |
| `initBdd` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L607) |
| `it` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L516) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `BddTestContext` | Context passed to hooks and tests (BDD-specific) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L29) |
| `HookFn` | Hook function | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L37) |
| `TestFn` | Test function that can be sync or async | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L15) |
| `TestOptions` | Test options for Deno sanitizers (ignored in Node/Bun) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L18) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `test` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L605) |

## Related

User guides:

- [extension-testing](../../guides/extension-testing.md): Test extensions with BDD utilities
