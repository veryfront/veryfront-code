---
title: "veryfront/testing"
description: "Cross-runtime BDD assertions and test helpers."
order: 38
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
| `afterAll`               | Register a hook after all BDD tests in a group.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L758)                      |
| `afterEach`              | Register a hook after each BDD test.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L733)                      |
| `assert`                 | Assert that a value is truthy.                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L285)                   |
| `assertEquals`           | Assert that two values are deeply equal.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L270)                   |
| `assertExists`           | Assert that a value is not null or undefined.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L290)                   |
| `assertGreater`          | Assert that a number is greater than another number.                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L354)                   |
| `assertGreaterOrEqual`   | Assert that a number is greater than or equal to another number.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L359)                   |
| `assertInstanceOf`       | Assert that a value is an instance of a constructor.                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L325)                   |
| `assertLess`             | Assert that a number is less than another number.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L364)                   |
| `assertLessOrEqual`      | Assert that a number is less than or equal to another number.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L369)                   |
| `assertMatch`            | Assert that a string matches a regular expression.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L320)                   |
| `assertNotEquals`        | Assert that two values are not deeply equal.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L275)                   |
| `assertNotStrictEquals`  | Assert that two values are not strictly equal.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L340)                   |
| `assertObjectMatch`      | Assert that an object contains matching properties.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L345)                   |
| `assertRejects`          | Assert that an async function rejects, returning the rejection reason.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L305)                   |
| `assertStrictEquals`     | Assert that two values are strictly equal.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L280)                   |
| `assertStringIncludes`   | Assert that a string contains another string.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L315)                   |
| `assertThrows`           | Assert that a synchronous function throws.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L295)                   |
| `beforeAll`              | Register a hook before all BDD tests in a group.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L743)                      |
| `beforeEach`             | Register a hook before each BDD test.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L724)                      |
| `chmod`                  | Change file permissions, rejecting operational failures.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L598)               |
| `createFileSystem`       | Create the runtime-native filesystem implementation.                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L448)               |
| `cwd`                    | Return the current working directory.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L25) |
| `deepEquals`             | ********************* Shared utility functions for cross-runtime testing. ********************* | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/utils.ts#L4)                      |
| `delay`                  | Wait for a duration in milliseconds.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L122)              |
| `deleteEnv`              | Delete a process environment variable.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L254)      |
| `describe`               | Group related BDD tests.                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L610)                      |
| `env`                    | Read and write process environment variables.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L56)       |
| `exists`                 | Return false for a missing path and propagate every other filesystem error.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L521)               |
| `exit`                   | Exit the current process.                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L127)              |
| `fail`                   | Fail the current assertion immediately.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L335)                   |
| `getArgs`                | Get command-line arguments (cross-runtime: Deno.args or process.argv).                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L9)  |
| `getEnv`                 | Read an environment variable from the active project scope.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L154)      |
| `getTestTimeScale`       | Return test time scale.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L3)                     |
| `isAlreadyExistsError`   | Error shape for is already exists.                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L627)               |
| `isNotFoundError`        |                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/not-found-error.ts#L209)  |
| `it`                     | Define a BDD test case.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L666)                      |
| `makeTempDir`            | Atomically create a unique directory beneath the operating-system temp root.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L593)               |
| `makeTempDirWithOptions` | Options accepted by make temp dir with.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L72)               |
| `makeTempFile`           | Create temp file.                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L47)               |
| `mkdir`                  | Create a directory.                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L571)               |
| `readDir`                | Read directory entries.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L581)               |
| `readFile`               | Read a file as bytes.                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L506)               |
| `readTextFile`           | Read a file as text.                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L501)               |
| `registerTestCleanup`    | Registers test cleanup.                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/isolation.ts#L21)                 |
| `remove`                 | Remove a file or directory, rejecting when the path does not exist.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L576)               |
| `resetAllTestState`      | Comprehensive reset of ALL test state across the application.                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/isolation.ts#L63)                 |
| `safeStringify`          | Serialize unknown values safely for test output.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/utils.ts#L33)                     |
| `scaleMs`                | Scale a duration for the current test runtime.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L8)                     |
| `setEnv`                 | Sets env.                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L234)      |
| `stat`                   | Read file metadata.                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L526)               |
| `testDelay`              | Wait for a test-scaled duration.                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L14)                    |
| `waitFor`                | Wait until a condition succeeds.                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L98)               |
| `withEnv`                | Applies env.                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L185)              |
| `withTempDir`            | Applies temp dir.                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L137)              |
| `withTempFile`           | Applies temp file.                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L161)              |
| `writeFile`              | Write bytes to a file.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L516)               |
| `writeTextFile`          | Write text to a file.                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L511)               |

### Types

| Name             | Description                                            | Source                                                                                 |
| ---------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `BddTestContext` | Context passed to hooks and tests (BDD-specific)       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L32) |
| `TestOptions`    | Test options for Deno sanitizers (ignored in Node/Bun) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L21) |

### Constants

| Name     | Description                                                              | Source                                                                                              |
| -------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `isBun`  | True if running in Bun runtime (Bun also exposes process.versions.node). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L93)  |
| `isDeno` | True if running in the real Deno runtime rather than a dnt shim.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L102) |
| `isNode` | True if running in Node.js rather than a more specific compatible host.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L99)  |
| `test`   | Shared test value.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L773)             |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/testing/assert`

```ts
import { assert, assertEquals, assertExists } from "veryfront/testing/assert";
```

#### Functions

| Name                    | Description                                                            | Source                                                                                     |
| ----------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `assert`                | Assert that a value is truthy.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L285) |
| `assertEquals`          | Assert that two values are deeply equal.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L270) |
| `assertExists`          | Assert that a value is not null or undefined.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L290) |
| `assertGreater`         | Assert that a number is greater than another number.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L354) |
| `assertGreaterOrEqual`  | Assert that a number is greater than or equal to another number.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L359) |
| `assertInstanceOf`      | Assert that a value is an instance of a constructor.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L325) |
| `assertLess`            | Assert that a number is less than another number.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L364) |
| `assertLessOrEqual`     | Assert that a number is less than or equal to another number.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L369) |
| `assertMatch`           | Assert that a string matches a regular expression.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L320) |
| `assertNotEquals`       | Assert that two values are not deeply equal.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L275) |
| `assertNotStrictEquals` | Assert that two values are not strictly equal.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L340) |
| `assertObjectMatch`     | Assert that an object contains matching properties.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L345) |
| `assertRejects`         | Assert that an async function rejects, returning the rejection reason. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L305) |
| `assertStrictEquals`    | Assert that two values are strictly equal.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L280) |
| `assertStringIncludes`  | Assert that a string contains another string.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L315) |
| `assertThrows`          | Assert that a synchronous function throws.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L295) |
| `fail`                  | Fail the current assertion immediately.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L335) |

### `veryfront/testing/bdd`

Portable BDD testing utilities (describe, it, beforeEach, afterEach). In Deno: @std/testing/bdd with file, suite, and test environment overlays In Node.js: Uses node:test In Bun: Uses bun:test Deno test runs whose dependencies mutate environment variables before they import this module must use `--preload=veryfront/testing/bdd`.

```ts
import { afterAll, afterEach, beforeAll } from "veryfront/testing/bdd";
```

#### Functions

| Name         | Description                                      | Source                                                                                  |
| ------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `afterAll`   | Register a hook after all BDD tests in a group.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L758) |
| `afterEach`  | Register a hook after each BDD test.             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L733) |
| `beforeAll`  | Register a hook before all BDD tests in a group. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L743) |
| `beforeEach` | Register a hook before each BDD test.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L724) |
| `describe`   | Group related BDD tests.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L610) |
| `initBdd`    | Initialize the BDD test adapter.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L776) |
| `it`         | Define a BDD test case.                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L666) |

#### Types

| Name             | Description                                            | Source                                                                                 |
| ---------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `BddTestContext` | Context passed to hooks and tests (BDD-specific)       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L32) |
| `TestOptions`    | Test options for Deno sanitizers (ignored in Node/Bun) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L21) |

#### Constants

| Name   | Description        | Source                                                                                  |
| ------ | ------------------ | --------------------------------------------------------------------------------------- |
| `test` | Shared test value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L773) |
