---
title: "veryfront/testing"
description: "Cross-runtime BDD assertions and test helpers."
order: 36
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

| Name                     | Description                                                                                     | Source                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `afterAll`               | Register a hook after all BDD tests in a group.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L640)                      |
| `afterEach`              | Register a hook after each BDD test.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L620)                      |
| `assert`                 | Assert that a value is truthy.                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L284)                   |
| `assertEquals`           | Assert that two values are deeply equal.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L269)                   |
| `assertExists`           | Assert that a value is not null or undefined.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L289)                   |
| `assertGreater`          | Assert that a number is greater than another number.                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L353)                   |
| `assertGreaterOrEqual`   | Assert that a number is greater than or equal to another number.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L358)                   |
| `assertInstanceOf`       | Assert that a value is an instance of a constructor.                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L324)                   |
| `assertLess`             | Assert that a number is less than another number.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L363)                   |
| `assertLessOrEqual`      | Assert that a number is less than or equal to another number.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L368)                   |
| `assertMatch`            | Assert that a string matches a regular expression.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L319)                   |
| `assertNotEquals`        | Assert that two values are not deeply equal.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L274)                   |
| `assertNotStrictEquals`  | Assert that two values are not strictly equal.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L339)                   |
| `assertObjectMatch`      | Assert that an object contains matching properties.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L344)                   |
| `assertRejects`          | Assert that an async function rejects.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L304)                   |
| `assertStrictEquals`     | Assert that two values are strictly equal.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L279)                   |
| `assertStringIncludes`   | Assert that a string contains another string.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L314)                   |
| `assertThrows`           | Assert that a synchronous function throws.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L294)                   |
| `beforeAll`              | Register a hook before all BDD tests in a group.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L630)                      |
| `beforeEach`             | Register a hook before each BDD test.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L611)                      |
| `chmod`                  | Change file permissions, rejecting operational failures.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L588)               |
| `createFileSystem`       | Create the runtime-native filesystem implementation.                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L438)               |
| `cwd`                    | Return the current working directory.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L26) |
| `deepEquals`             | ********************* Shared utility functions for cross-runtime testing. ********************* | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/utils.ts#L5)                      |
| `delay`                  | Wait for a duration in milliseconds.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L123)              |
| `deleteEnv`              | Delete a process environment variable.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L205)      |
| `describe`               | Group related BDD tests.                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L497)                      |
| `env`                    | Read and write process environment variables.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L33)       |
| `exists`                 | Return false for a missing path and propagate every other filesystem error.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L511)               |
| `exit`                   | Exit the current process.                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L128)              |
| `fail`                   | Fail the current assertion immediately.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L334)                   |
| `getArgs`                | Get command-line arguments (cross-runtime: Deno.args or process.argv).                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L10) |
| `getEnv`                 | Read an environment variable from the active project scope.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L106)      |
| `getTestTimeScale`       | Return test time scale.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L4)                     |
| `isAlreadyExistsError`   | Error shape for is already exists.                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L617)               |
| `isNotFoundError`        |                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/not-found-error.ts#L210)  |
| `it`                     | Define a BDD test case.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L553)                      |
| `makeTempDir`            | Atomically create a unique directory beneath the operating-system temp root.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L583)               |
| `makeTempDirWithOptions` | Options accepted by make temp dir with.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L73)               |
| `makeTempFile`           | Create temp file.                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L48)               |
| `mkdir`                  | Create a directory.                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L561)               |
| `readDir`                | Read directory entries.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L571)               |
| `readFile`               | Read a file as bytes.                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L496)               |
| `readTextFile`           | Read a file as text.                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L491)               |
| `registerTestCleanup`    | Registers test cleanup.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/isolation.ts#L22)                 |
| `remove`                 | Remove a file or directory, rejecting when the path does not exist.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L566)               |
| `resetAllTestState`      | Comprehensive reset of ALL test state across the application.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/isolation.ts#L64)                 |
| `safeStringify`          | Serialize unknown values safely for test output.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/utils.ts#L34)                     |
| `scaleMs`                | Scale a duration for the current test runtime.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L9)                     |
| `setEnv`                 | Sets env.                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L185)      |
| `stat`                   | Read file metadata.                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L516)               |
| `testDelay`              | Wait for a test-scaled duration.                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L15)                    |
| `waitFor`                | Wait until a condition succeeds.                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L99)               |
| `withEnv`                | Applies env.                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L186)              |
| `withTempDir`            | Applies temp dir.                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L138)              |
| `withTempFile`           | Applies temp file.                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L162)              |
| `writeFile`              | Write bytes to a file.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L506)               |
| `writeTextFile`          | Write text to a file.                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L501)               |

### Types

| Name             | Description                                            | Source                                                                                 |
| ---------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `BddTestContext` | Context passed to hooks and tests (BDD-specific)       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L30) |
| `TestOptions`    | Test options for Deno sanitizers (ignored in Node/Bun) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L19) |

### Constants

| Name     | Description                                                              | Source                                                                                              |
| -------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `isBun`  | True if running in Bun runtime (Bun also exposes process.versions.node). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L94)  |
| `isDeno` | True if running in the real Deno runtime rather than a dnt shim.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L103) |
| `isNode` | True if running in Node.js rather than a more specific compatible host.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L100) |
| `test`   | Shared test value.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L650)             |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/testing/assert`

```ts
import { assert, assertEquals, assertExists } from "veryfront/testing/assert";
```

#### Functions

| Name                    | Description                                                      | Source                                                                                     |
| ----------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `assert`                | Assert that a value is truthy.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L284) |
| `assertEquals`          | Assert that two values are deeply equal.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L269) |
| `assertExists`          | Assert that a value is not null or undefined.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L289) |
| `assertGreater`         | Assert that a number is greater than another number.             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L353) |
| `assertGreaterOrEqual`  | Assert that a number is greater than or equal to another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L358) |
| `assertInstanceOf`      | Assert that a value is an instance of a constructor.             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L324) |
| `assertLess`            | Assert that a number is less than another number.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L363) |
| `assertLessOrEqual`     | Assert that a number is less than or equal to another number.    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L368) |
| `assertMatch`           | Assert that a string matches a regular expression.               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L319) |
| `assertNotEquals`       | Assert that two values are not deeply equal.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L274) |
| `assertNotStrictEquals` | Assert that two values are not strictly equal.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L339) |
| `assertObjectMatch`     | Assert that an object contains matching properties.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L344) |
| `assertRejects`         | Assert that an async function rejects.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L304) |
| `assertStrictEquals`    | Assert that two values are strictly equal.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L279) |
| `assertStringIncludes`  | Assert that a string contains another string.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L314) |
| `assertThrows`          | Assert that a synchronous function throws.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L294) |
| `fail`                  | Fail the current assertion immediately.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L334) |

### `veryfront/testing/bdd`

Portable BDD testing utilities (describe, it, beforeEach, afterEach). In Deno: Direct re-export from @std/testing/bdd (no wrapper) In Node.js: Uses node:test In Bun: Uses bun:test

```ts
import { afterAll, afterEach, beforeAll } from "veryfront/testing/bdd";
```

#### Functions

| Name         | Description                                      | Source                                                                                  |
| ------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `afterAll`   | Register a hook after all BDD tests in a group.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L640) |
| `afterEach`  | Register a hook after each BDD test.             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L620) |
| `beforeAll`  | Register a hook before all BDD tests in a group. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L630) |
| `beforeEach` | Register a hook before each BDD test.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L611) |
| `describe`   | Group related BDD tests.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L497) |
| `initBdd`    | Initialize the BDD test adapter.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L653) |
| `it`         | Define a BDD test case.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L553) |

#### Types

| Name             | Description                                            | Source                                                                                 |
| ---------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `BddTestContext` | Context passed to hooks and tests (BDD-specific)       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L30) |
| `TestOptions`    | Test options for Deno sanitizers (ignored in Node/Bun) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L19) |

#### Constants

| Name   | Description        | Source                                                                                  |
| ------ | ------------------ | --------------------------------------------------------------------------------------- |
| `test` | Shared test value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L650) |
