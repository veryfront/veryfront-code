---
title: "veryfront/testing"
description: "Cross-runtime BDD assertions and test helpers."
order: 39
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

| Name                     | Description                                                                                     | Source                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `afterAll`               | Register a hook after all BDD tests in a group.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts)                       |
| `afterEach`              | Register a hook after each BDD test.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts)                       |
| `assert`                 | Assert that a value is truthy.                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts)                    |
| `assertEquals`           | Assert that two values are deeply equal.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts)                    |
| `assertExists`           | Assert that a value is not null or undefined.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts)                    |
| `assertGreater`          | Assert that a number is greater than another number.                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts)                    |
| `assertGreaterOrEqual`   | Assert that a number is greater than or equal to another number.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts)                    |
| `assertInstanceOf`       | Assert that a value is an instance of a constructor.                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts)                    |
| `assertLess`             | Assert that a number is less than another number.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts)                    |
| `assertLessOrEqual`      | Assert that a number is less than or equal to another number.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts)                    |
| `assertMatch`            | Assert that a string matches a regular expression.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts)                    |
| `assertNotEquals`        | Assert that two values are not deeply equal.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts)                    |
| `assertNotStrictEquals`  | Assert that two values are not strictly equal.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts)                    |
| `assertObjectMatch`      | Assert that an object contains matching properties.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts)                    |
| `assertRejects`          | Assert that an async function rejects, returning the rejection reason.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts)                    |
| `assertStrictEquals`     | Assert that two values are strictly equal.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts)                    |
| `assertStringIncludes`   | Assert that a string contains another string.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts)                    |
| `assertThrows`           | Assert that a synchronous function throws.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts)                    |
| `beforeAll`              | Register a hook before all BDD tests in a group.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts)                       |
| `beforeEach`             | Register a hook before each BDD test.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts)                       |
| `chmod`                  | Change file permissions, rejecting operational failures.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts)                |
| `createFileSystem`       | Create the runtime-native filesystem implementation.                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts)                |
| `cwd`                    | Return the current working directory.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts) |
| `deepEquals`             | ********************* Shared utility functions for cross-runtime testing. ********************* | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/utils.ts)                     |
| `delay`                  | Wait for a duration in milliseconds.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts)               |
| `deleteEnv`              | Delete a process environment variable.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts)       |
| `describe`               | Group related BDD tests.                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts)                       |
| `env`                    | Read and write process environment variables.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts)       |
| `exists`                 | Return false for a missing path and propagate every other filesystem error.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts)                |
| `exit`                   | Exit the current process.                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts)               |
| `fail`                   | Fail the current assertion immediately.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts)                    |
| `getArgs`                | Get command-line arguments (cross-runtime: Deno.args or process.argv).                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts) |
| `getEnv`                 | Read an environment variable from the active project scope.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts)       |
| `getTestTimeScale`       | Return the current test time scale. Preserved for compatibility.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts)                    |
| `isAlreadyExistsError`   | Error shape for is already exists.                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts)                |
| `isNotFoundError`        |                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/not-found-error.ts)   |
| `it`                     | Define a BDD test case.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts)                       |
| `makeTempDir`            | Atomically create a unique directory beneath the operating-system temp root.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts)                |
| `makeTempDirWithOptions` | Options accepted by make temp dir with.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts)               |
| `makeTempFile`           | Create temp file.                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts)               |
| `mkdir`                  | Create a directory.                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts)                |
| `readDir`                | Read directory entries.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts)                |
| `readFile`               | Read a file as bytes.                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts)                |
| `readTextFile`           | Read a file as text.                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts)                |
| `registerTestCleanup`    | Registers test cleanup.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/isolation.ts)                 |
| `remove`                 | Remove a file or directory, rejecting when the path does not exist.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts)                |
| `resetAllTestState`      | Comprehensive reset of ALL test state across the application.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/isolation.ts)                 |
| `safeStringify`          | Serialize unknown values safely for test output.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/utils.ts)                     |
| `scaleMs`                | Scale a duration for the current test runtime.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts)                    |
| `setEnv`                 | Sets env.                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts)       |
| `stat`                   | Read file metadata.                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts)                |
| `testDelay`              | Wait for a test-scaled duration.                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts)                    |
| `waitFor`                | Wait until a condition succeeds.                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts)               |
| `withEnv`                | Applies env.                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts)               |
| `withTempDir`            | Applies temp dir.                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts)               |
| `withTempFile`           | Applies temp file.                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts)               |
| `writeFile`              | Write bytes to a file.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts)                |
| `writeTextFile`          | Write text to a file.                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts)                |

### Types

| Name             | Description                                            | Source                                                                             |
| ---------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `BddTestContext` | Context passed to hooks and tests (BDD-specific)       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts) |
| `TestOptions`    | Test options for Deno sanitizers (ignored in Node/Bun) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts) |

### Constants

| Name     | Description                                                              | Source                                                                                         |
| -------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `isBun`  | True if running in Bun runtime (Bun also exposes process.versions.node). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts) |
| `isDeno` | True if running in the real Deno runtime rather than a dnt shim.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts) |
| `isNode` | True if running in Node.js rather than a more specific compatible host.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts) |
| `test`   | Shared test value.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts)             |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/testing/assert`

```ts
import { assert, assertEquals, assertExists } from "veryfront/testing/assert";
```

#### Functions

| Name                    | Description                                                            | Source                                                                                |
| ----------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `assert`                | Assert that a value is truthy.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts) |
| `assertEquals`          | Assert that two values are deeply equal.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts) |
| `assertExists`          | Assert that a value is not null or undefined.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts) |
| `assertGreater`         | Assert that a number is greater than another number.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts) |
| `assertGreaterOrEqual`  | Assert that a number is greater than or equal to another number.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts) |
| `assertInstanceOf`      | Assert that a value is an instance of a constructor.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts) |
| `assertLess`            | Assert that a number is less than another number.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts) |
| `assertLessOrEqual`     | Assert that a number is less than or equal to another number.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts) |
| `assertMatch`           | Assert that a string matches a regular expression.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts) |
| `assertNotEquals`       | Assert that two values are not deeply equal.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts) |
| `assertNotStrictEquals` | Assert that two values are not strictly equal.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts) |
| `assertObjectMatch`     | Assert that an object contains matching properties.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts) |
| `assertRejects`         | Assert that an async function rejects, returning the rejection reason. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts) |
| `assertStrictEquals`    | Assert that two values are strictly equal.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts) |
| `assertStringIncludes`  | Assert that a string contains another string.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts) |
| `assertThrows`          | Assert that a synchronous function throws.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts) |
| `fail`                  | Fail the current assertion immediately.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts) |

### `veryfront/testing/bdd`

Portable BDD testing utilities (describe, it, beforeEach, afterEach). In Deno: @std/testing/bdd with file, suite, and test environment overlays In Node.js: Uses node:test In Bun: Uses bun:test Deno test runs whose dependencies mutate environment variables before they import this module must use `--preload=veryfront/testing/bdd`.

```ts
import { afterAll, afterEach, beforeAll } from "veryfront/testing/bdd";
```

#### Functions

| Name         | Description                                      | Source                                                                             |
| ------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `afterAll`   | Register a hook after all BDD tests in a group.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts) |
| `afterEach`  | Register a hook after each BDD test.             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts) |
| `beforeAll`  | Register a hook before all BDD tests in a group. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts) |
| `beforeEach` | Register a hook before each BDD test.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts) |
| `describe`   | Group related BDD tests.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts) |
| `initBdd`    | Initialize the BDD test adapter.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts) |
| `it`         | Define a BDD test case.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts) |

#### Types

| Name             | Description                                            | Source                                                                             |
| ---------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `BddTestContext` | Context passed to hooks and tests (BDD-specific)       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts) |
| `TestOptions`    | Test options for Deno sanitizers (ignored in Node/Bun) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts) |

#### Constants

| Name   | Description        | Source                                                                             |
| ------ | ------------------ | ---------------------------------------------------------------------------------- |
| `test` | Shared test value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts) |
