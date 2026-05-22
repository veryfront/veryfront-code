---
title: "veryfront/testing"
description: "Cross-runtime test utilities — BDD framework (describe/it), assertions, test isolation, filesystem/env helpers, and timing utilities for Deno, Node, and Bun."
order: 27
---

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
| `afterAll` | Register a hook after all BDD tests in a group. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L604) |
| `afterEach` | Register a hook after each BDD test. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L586) |
| `assert` | Assert that a value is truthy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L283) |
| `assertEquals` | Assert that two values are deeply equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L268) |
| `assertExists` | Assert that a value is not null or undefined. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L288) |
| `assertGreater` | Assert that a number is greater than another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L352) |
| `assertGreaterOrEqual` | Assert that a number is greater than or equal to another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L357) |
| `assertInstanceOf` | Assert that a value is an instance of a constructor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L323) |
| `assertLess` | Assert that a number is less than another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L362) |
| `assertLessOrEqual` | Assert that a number is less than or equal to another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L367) |
| `assertMatch` | Assert that a string matches a regular expression. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L318) |
| `assertNotEquals` | Assert that two values are not deeply equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L273) |
| `assertNotStrictEquals` | Assert that two values are not strictly equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L338) |
| `assertObjectMatch` | Assert that an object contains matching properties. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L343) |
| `assertRejects` | Assert that an async function rejects. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L303) |
| `assertStrictEquals` | Assert that two values are strictly equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L278) |
| `assertStringIncludes` | Assert that a string contains another string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L313) |
| `assertThrows` | Assert that a synchronous function throws. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L293) |
| `beforeAll` | Register a hook before all BDD tests in a group. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L595) |
| `beforeEach` | Register a hook before each BDD test. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L577) |
| `chmod` | Change file permissions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L325) |
| `createFileSystem` | Create file system. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L261) |
| `cwd` | Return the current working directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L19) |
| `deepEquals` | ********************* Shared utility functions for cross-runtime testing. ********************* | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/utils.ts#L5) |
| `delay` | Wait for a duration in milliseconds. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L123) |
| `deleteEnv` | Delete a process environment variable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L199) |
| `describe` | Group related BDD tests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L464) |
| `env` | Read and write process environment variables. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L32) |
| `exists` | Check whether a path exists. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L293) |
| `exit` | Exit the current process. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L128) |
| `fail` | Fail the current assertion immediately. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L333) |
| `getArgs` | Get command-line arguments (cross-runtime: Deno.args or process.argv). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L5) |
| `getEnv` | Read an environment variable from the active project scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L104) |
| `getTestTimeScale` | Return test time scale. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L16) |
| `isAlreadyExistsError` | Error shape for is already exists. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L364) |
| `isNotFoundError` | Error shape for is not found. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L350) |
| `it` | Define a BDD test case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L519) |
| `makeTempDir` | Create temp dir. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L320) |
| `makeTempDirWithOptions` | Options accepted by make temp dir with. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L73) |
| `makeTempFile` | Create temp file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L48) |
| `mkdir` | Create a directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L303) |
| `readDir` | Read directory entries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L313) |
| `readFile` | Read a file as bytes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L278) |
| `readTextFile` | Read a file as text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L273) |
| `registerTestCleanup` | Registers test cleanup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/isolation.ts#L22) |
| `remove` | Remove a file or directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L308) |
| `resetAllTestState` | Comprehensive reset of ALL test state across the application. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/isolation.ts#L64) |
| `safeStringify` | Serialize unknown values safely for test output. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/utils.ts#L34) |
| `scaleMs` | Scale a duration for the current test runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L21) |
| `setEnv` | Sets env. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L180) |
| `stat` | Read file metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L298) |
| `testDelay` | Wait for a test-scaled duration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L27) |
| `waitFor` | Wait until a condition succeeds. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L99) |
| `withEnv` | Applies env. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L186) |
| `withTempDir` | Applies temp dir. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L138) |
| `withTempFile` | Applies temp file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L162) |
| `writeFile` | Write bytes to a file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L288) |
| `writeTextFile` | Write text to a file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L283) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `BddTestContext` | Context passed to hooks and tests (BDD-specific) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L30) |
| `TestOptions` | Test options for Deno sanitizers (ignored in Node/Bun) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L19) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `isBun` | True if running in Bun runtime (check first since Bun has process.versions.node) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L55) |
| `isDeno` | True if running in real Deno runtime (not dnt shim) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L61) |
| `isNode` | True if running in Node.js runtime (has process.versions.node, not Bun, not shimmed Deno) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L58) |
| `test` | Shared test value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L613) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/testing/assert`

```ts
import { assert, assertEquals, assertExists } from "veryfront/testing/assert";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `assert` | Assert that a value is truthy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L283) |
| `assertEquals` | Assert that two values are deeply equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L268) |
| `assertExists` | Assert that a value is not null or undefined. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L288) |
| `assertGreater` | Assert that a number is greater than another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L352) |
| `assertGreaterOrEqual` | Assert that a number is greater than or equal to another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L357) |
| `assertInstanceOf` | Assert that a value is an instance of a constructor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L323) |
| `assertLess` | Assert that a number is less than another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L362) |
| `assertLessOrEqual` | Assert that a number is less than or equal to another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L367) |
| `assertMatch` | Assert that a string matches a regular expression. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L318) |
| `assertNotEquals` | Assert that two values are not deeply equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L273) |
| `assertNotStrictEquals` | Assert that two values are not strictly equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L338) |
| `assertObjectMatch` | Assert that an object contains matching properties. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L343) |
| `assertRejects` | Assert that an async function rejects. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L303) |
| `assertStrictEquals` | Assert that two values are strictly equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L278) |
| `assertStringIncludes` | Assert that a string contains another string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L313) |
| `assertThrows` | Assert that a synchronous function throws. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L293) |
| `fail` | Fail the current assertion immediately. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L333) |

### `veryfront/testing/bdd`

Portable BDD testing utilities (describe, it, beforeEach, afterEach). In Deno: Direct re-export from @std/testing/bdd (no wrapper) In Node.js: Uses node:test In Bun: Uses bun:test

```ts
import { afterAll, afterEach, beforeAll } from "veryfront/testing/bdd";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `afterAll` | Register a hook after all BDD tests in a group. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L604) |
| `afterEach` | Register a hook after each BDD test. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L586) |
| `beforeAll` | Register a hook before all BDD tests in a group. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L595) |
| `beforeEach` | Register a hook before each BDD test. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L577) |
| `describe` | Group related BDD tests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L464) |
| `initBdd` | Initialize the BDD test adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L616) |
| `it` | Define a BDD test case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L519) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `BddTestContext` | Context passed to hooks and tests (BDD-specific) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L30) |
| `TestOptions` | Test options for Deno sanitizers (ignored in Node/Bun) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L19) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `test` | Shared test value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L613) |

## Related

User guides:

- [extension-testing](../../guides/extension-testing.md): Test extensions with BDD utilities
