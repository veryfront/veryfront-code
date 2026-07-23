---
title: "veryfront/testing"
description: "Cross-runtime BDD assertions and test helpers."
order: 33
---

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
| `afterAll` | Register a hook after all BDD tests in a group. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L743) |
| `afterEach` | Register a hook after each BDD test. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L719) |
| `assert` | Assert that a value is truthy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L432) |
| `assertEquals` | Assert that two values are deeply equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L417) |
| `assertExists` | Assert that a value is not null or undefined. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L437) |
| `assertGreater` | Assert that a number is greater than another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L525) |
| `assertGreaterOrEqual` | Assert that a number is greater than or equal to another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L530) |
| `assertInstanceOf` | Assert that a value is an instance of a constructor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L496) |
| `assertLess` | Assert that a number is less than another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L535) |
| `assertLessOrEqual` | Assert that a number is less than or equal to another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L540) |
| `assertMatch` | Assert that a string matches a regular expression. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L491) |
| `assertNotEquals` | Assert that two values are not deeply equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L422) |
| `assertNotStrictEquals` | Assert that two values are not strictly equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L511) |
| `assertObjectMatch` | Assert that an object contains matching properties. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L516) |
| `assertRejects` | Assert that an async function rejects. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L464) |
| `assertRejects` | Assert that an async function rejects with the expected error type and message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L469) |
| `assertRejects` | Assert that an async function rejects. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L476) |
| `assertStrictEquals` | Assert that two values are strictly equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L427) |
| `assertStringIncludes` | Assert that a string contains another string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L486) |
| `assertThrows` | Assert that a synchronous function throws. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L442) |
| `assertThrows` | Assert that a synchronous function throws the expected error type and message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L447) |
| `assertThrows` | Assert that a synchronous function throws. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L454) |
| `beforeAll` | Register a hook before all BDD tests in a group. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L731) |
| `beforeEach` | Register a hook before each BDD test. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L707) |
| `chmod` | Change file permissions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L414) |
| `createFileSystem` | Create a filesystem implementation for the active runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L338) |
| `cwd` | Return the current working directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L21) |
| `deepEquals` | Compare values recursively using cross-runtime value equality. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/utils.ts#L415) |
| `delay` | Wait for a duration in milliseconds. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L243) |
| `deleteEnv` | Delete a process environment variable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L231) |
| `describe` | Group related BDD tests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L526) |
| `env` | Read and write process environment variables. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L32) |
| `exists` | Check whether a path exists. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L370) |
| `exit` | Exit the current process. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L248) |
| `fail` | Fail the current assertion immediately. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L506) |
| `getArgs` | Get command-line arguments (cross-runtime: Deno.args or process.argv). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L5) |
| `getEnv` | Read an environment variable from the active project scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L119) |
| `getTestTimeScale` | Return test time scale. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L23) |
| `isAlreadyExistsError` | Return whether an unknown error reports that a filesystem entry already exists, including matching errors in a cause chain. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L497) |
| `isNotFoundError` | Return whether an unknown error represents a missing path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L470) |
| `it` | Define a BDD test case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L614) |
| `makeTempDir` | Create a uniquely named directory under the runtime's temporary directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L409) |
| `makeTempDirWithOptions` | Create a temporary directory, optionally under a specific base directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L107) |
| `makeTempFile` | Create temp file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L71) |
| `mkdir` | Create a directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L387) |
| `readDir` | Read directory entries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L397) |
| `readFile` | Read a file as bytes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L355) |
| `readTextFile` | Read a file as text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L350) |
| `registerTestCleanup` | Registers test cleanup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/isolation.ts#L31) |
| `remove` | Remove a file or directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L392) |
| `resetAllTestState` | Serialize and run registered and framework-owned test-state cleanup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/isolation.ts#L86) |
| `safeStringify` | Serialize unknown values safely for test output. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/utils.ts#L628) |
| `scaleMs` | Scale a duration for the current test runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L28) |
| `setEnv` | Sets env. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L211) |
| `stat` | Read file metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L375) |
| `testDelay` | Wait for a test-scaled duration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L40) |
| `waitFor` | Wait until a condition succeeds. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L210) |
| `withEnv` | Run a callback with isolated environment variable overrides. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L317) |
| `withTempDir` | Run a callback with a temporary directory, then remove the directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L294) |
| `withTempFile` | Run a callback with a temporary file, then remove the file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L303) |
| `writeFile` | Write bytes to a file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L365) |
| `writeTextFile` | Write text to a file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L360) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `BddTestContext` | Context passed to BDD hooks and tests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L42) |
| `CleanupTask` | Cleanup callback run by the shared test-state reset. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/isolation.ts#L15) |
| `ErrorClass` | Public API contract for error class. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L7) |
| `FileInfo` | Portable metadata returned for a filesystem path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/base.ts#L208) |
| `FileSystem` | Public API contract for file system. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L19) |
| `HookFn` | Hook function that can be sync or async. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L57) |
| `TestFn` | Test function that can be sync or async. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L54) |
| `TestOptions` | Portable test options. Sanitizer fields only apply to Deno. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L24) |
| `WaitForOptions` | Options for bounded condition polling. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L142) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `isBun` | True if running in Bun. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L139) |
| `isDeno` | True if running in native Deno rather than a compatibility shim. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L145) |
| `isNode` | True if running in Node.js. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L142) |
| `test` | Shared test value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L755) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/testing/assert`

```ts
import { assert, assertEquals, assertExists } from "veryfront/testing/assert";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `assert` | Assert that a value is truthy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L432) |
| `assertEquals` | Assert that two values are deeply equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L417) |
| `assertExists` | Assert that a value is not null or undefined. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L437) |
| `assertGreater` | Assert that a number is greater than another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L525) |
| `assertGreaterOrEqual` | Assert that a number is greater than or equal to another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L530) |
| `assertInstanceOf` | Assert that a value is an instance of a constructor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L496) |
| `assertLess` | Assert that a number is less than another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L535) |
| `assertLessOrEqual` | Assert that a number is less than or equal to another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L540) |
| `assertMatch` | Assert that a string matches a regular expression. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L491) |
| `assertNotEquals` | Assert that two values are not deeply equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L422) |
| `assertNotStrictEquals` | Assert that two values are not strictly equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L511) |
| `assertObjectMatch` | Assert that an object contains matching properties. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L516) |
| `assertRejects` | Assert that an async function rejects. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L464) |
| `assertRejects` | Assert that an async function rejects with the expected error type and message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L469) |
| `assertRejects` | Assert that an async function rejects. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L476) |
| `assertStrictEquals` | Assert that two values are strictly equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L427) |
| `assertStringIncludes` | Assert that a string contains another string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L486) |
| `assertThrows` | Assert that a synchronous function throws. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L442) |
| `assertThrows` | Assert that a synchronous function throws the expected error type and message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L447) |
| `assertThrows` | Assert that a synchronous function throws. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L454) |
| `fail` | Fail the current assertion immediately. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L506) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ErrorClass` | Public API contract for error class. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L7) |

### `veryfront/testing/bdd`

Portable BDD testing utilities (describe, it, beforeEach, afterEach). In Deno: Uses @std/testing/bdd In Node.js: Uses node:test In Bun: Uses bun:test

```ts
import { afterAll, afterEach, beforeAll } from "veryfront/testing/bdd";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `afterAll` | Register a hook after all BDD tests in a group. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L743) |
| `afterEach` | Register a hook after each BDD test. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L719) |
| `beforeAll` | Register a hook before all BDD tests in a group. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L731) |
| `beforeEach` | Register a hook before each BDD test. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L707) |
| `describe` | Group related BDD tests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L526) |
| `initBdd` | Initialize the BDD test adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L758) |
| `it` | Define a BDD test case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L614) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `BddTestContext` | Context passed to BDD hooks and tests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L42) |
| `HookFn` | Hook function that can be sync or async. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L57) |
| `TestFn` | Test function that can be sync or async. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L54) |
| `TestOptions` | Portable test options. Sanitizer fields only apply to Deno. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L24) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `test` | Shared test value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L755) |
