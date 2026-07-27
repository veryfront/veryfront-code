---
title: "veryfront/testing"
description: "Cross-runtime BDD assertions and test helpers."
order: 34
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

| Name                     | Description                                                                                        | Source                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `afterAll`               | Register a hook after all BDD tests in a group.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L724)                      |
| `afterEach`              | Register a hook after each BDD test.                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L704)                      |
| `assert`                 | Assert that a value is truthy.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L391)                   |
| `assertEquals`           | Assert that two values are deeply equal.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L376)                   |
| `assertExists`           | Assert that a value is not null or undefined.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L396)                   |
| `assertGreater`          | Assert that a number is greater than another number.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L467)                   |
| `assertGreaterOrEqual`   | Assert that a number is greater than or equal to another number.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L472)                   |
| `assertInstanceOf`       | Assert that a value is an instance of a constructor.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L438)                   |
| `assertLess`             | Assert that a number is less than another number.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L477)                   |
| `assertLessOrEqual`      | Assert that a number is less than or equal to another number.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L482)                   |
| `assertMatch`            | Assert that a string matches a regular expression.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L433)                   |
| `assertNotEquals`        | Assert that two values are not deeply equal.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L381)                   |
| `assertNotStrictEquals`  | Assert that two values are not strictly equal.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L453)                   |
| `assertObjectMatch`      | Assert that an object contains matching properties.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L458)                   |
| `assertRejects`          | Assert that an async function rejects.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L418)                   |
| `assertStrictEquals`     | Assert that two values are strictly equal.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L386)                   |
| `assertStringIncludes`   | Assert that a string contains another string.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L428)                   |
| `assertThrows`           | Assert that a synchronous function throws and return its captured value.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L401)                   |
| `assertThrows`           |                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L402)                   |
| `assertThrows`           |                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L408)                   |
| `beforeAll`              | Register a hook before all BDD tests in a group.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L714)                      |
| `beforeEach`             | Register a hook before each BDD test.                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L695)                      |
| `chmod`                  | Change file permissions, rejecting operational failures.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L491)               |
| `createFileSystem`       | Create the runtime-native filesystem implementation.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L382)               |
| `cwd`                    | Return the current working directory.                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L26) |
| `deepEquals`             | Compare values with the same value semantics used by `@std/assert`.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/utils.ts#L15)                     |
| `delay`                  | Wait for a duration in milliseconds.                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L159)              |
| `deleteEnv`              | Delete a process environment variable.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L205)      |
| `describe`               | Group related BDD tests.                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L581)                      |
| `env`                    | Read and write process environment variables.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L33)       |
| `exists`                 | Return false for a missing path and propagate every other filesystem error.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L414)               |
| `exit`                   | Exit the current process.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L164)              |
| `fail`                   | Fail the current assertion immediately.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L448)                   |
| `getArgs`                | Get command-line arguments (cross-runtime: Deno.args or process.argv).                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L10) |
| `getEnv`                 | Read an environment variable from the active project scope.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L106)      |
| `getTestTimeScale`       | Return test time scale.                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L4)                     |
| `isAlreadyExistsError`   | Error shape for is already exists.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L551)               |
| `isNotFoundError`        | Return whether an error or its cause chain represents a missing path.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L529)               |
| `it`                     | Define a BDD test case.                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L637)                      |
| `makeTempDir`            | Atomically create a unique directory beneath the operating-system temp root.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L486)               |
| `makeTempDirWithOptions` | Atomically create a uniquely named temporary directory.                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L99)               |
| `makeTempFile`           | Atomically create a uniquely named temporary file.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L49)               |
| `mkdir`                  | Create a directory.                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L464)               |
| `readDir`                | Read directory entries.                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L474)               |
| `readFile`               | Read a file as bytes.                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L399)               |
| `readTextFile`           | Read a file as text.                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L394)               |
| `registerTestCleanup`    | Register one cleanup invocation for the next comprehensive state reset.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/isolation.ts#L26)                 |
| `remove`                 | Remove a file or directory, rejecting when the path does not exist.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L469)               |
| `resetAllTestState`      | Comprehensive reset of ALL test state across the application.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/isolation.ts#L69)                 |
| `safeStringify`          | Serialize unknown values safely for test output.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/utils.ts#L241)                    |
| `scaleMs`                | Scale a duration for the current test runtime.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L9)                     |
| `setEnv`                 | Sets env.                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L185)      |
| `stat`                   | Read file metadata.                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L419)               |
| `testDelay`              | Wait for a test-scaled duration.                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L15)                    |
| `waitFor`                | Poll a condition immediately and at intervals until it succeeds or the monotonic deadline expires. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L128)              |
| `withEnv`                | Run a callback with an async-context-isolated environment overlay.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L253)              |
| `withTempDir`            | Run a callback with a temporary directory and reliably remove it afterward.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L174)              |
| `withTempFile`           | Run a callback with a temporary file and reliably remove it afterward.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L195)              |
| `writeFile`              | Write bytes to a file.                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L409)               |
| `writeTextFile`          | Write text to a file.                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L404)               |

### Types

| Name             | Description                                            | Source                                                                                 |
| ---------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `BddTestContext` | Context passed to hooks and tests (BDD-specific)       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L40) |
| `TestOptions`    | Test options for Deno sanitizers (ignored in Node/Bun) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L29) |

### Constants

| Name     | Description                                                              | Source                                                                                              |
| -------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `isBun`  | True if running in Bun runtime (Bun also exposes process.versions.node). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L94)  |
| `isDeno` | True if running in the real Deno runtime rather than a dnt shim.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L103) |
| `isNode` | True if running in Node.js rather than a more specific compatible host.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L100) |
| `test`   | Shared test value.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L734)             |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/testing/assert`

```ts
import { assert, assertEquals, assertExists } from "veryfront/testing/assert";
```

#### Functions

| Name                    | Description                                                              | Source                                                                                     |
| ----------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `assert`                | Assert that a value is truthy.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L391) |
| `assertEquals`          | Assert that two values are deeply equal.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L376) |
| `assertExists`          | Assert that a value is not null or undefined.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L396) |
| `assertGreater`         | Assert that a number is greater than another number.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L467) |
| `assertGreaterOrEqual`  | Assert that a number is greater than or equal to another number.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L472) |
| `assertInstanceOf`      | Assert that a value is an instance of a constructor.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L438) |
| `assertLess`            | Assert that a number is less than another number.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L477) |
| `assertLessOrEqual`     | Assert that a number is less than or equal to another number.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L482) |
| `assertMatch`           | Assert that a string matches a regular expression.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L433) |
| `assertNotEquals`       | Assert that two values are not deeply equal.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L381) |
| `assertNotStrictEquals` | Assert that two values are not strictly equal.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L453) |
| `assertObjectMatch`     | Assert that an object contains matching properties.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L458) |
| `assertRejects`         | Assert that an async function rejects.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L418) |
| `assertStrictEquals`    | Assert that two values are strictly equal.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L386) |
| `assertStringIncludes`  | Assert that a string contains another string.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L428) |
| `assertThrows`          | Assert that a synchronous function throws and return its captured value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L401) |
| `assertThrows`          |                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L402) |
| `assertThrows`          |                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L408) |
| `fail`                  | Fail the current assertion immediately.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L448) |

### `veryfront/testing/bdd`

Portable BDD testing utilities (describe, it, beforeEach, afterEach). Delegates to `@std/testing/bdd` in Deno, `node:test` in Node.js, and `bun:test` in Bun. Test bodies are isolated from process-environment leaks in every runtime. In Bun, lifecycle-hook mutations share that scope when hooks are declared inside a `describe` suite; root-level hooks follow Bun's native process-wide behavior.

```ts
import { afterAll, afterEach, beforeAll } from "veryfront/testing/bdd";
```

#### Functions

| Name         | Description                                      | Source                                                                                  |
| ------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `afterAll`   | Register a hook after all BDD tests in a group.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L724) |
| `afterEach`  | Register a hook after each BDD test.             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L704) |
| `beforeAll`  | Register a hook before all BDD tests in a group. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L714) |
| `beforeEach` | Register a hook before each BDD test.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L695) |
| `describe`   | Group related BDD tests.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L581) |
| `initBdd`    | Initialize the BDD test adapter.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L737) |
| `it`         | Define a BDD test case.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L637) |

#### Types

| Name             | Description                                            | Source                                                                                 |
| ---------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `BddTestContext` | Context passed to hooks and tests (BDD-specific)       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L40) |
| `TestOptions`    | Test options for Deno sanitizers (ignored in Node/Bun) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L29) |

#### Constants

| Name   | Description        | Source                                                                                  |
| ------ | ------------------ | --------------------------------------------------------------------------------------- |
| `test` | Shared test value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L734) |
