---
title: "veryfront/testing"
description: "Cross-runtime BDD assertions and test helpers."
order: 32
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
| `afterAll` | Register a hook after all BDD tests in a group. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L742) |
| `afterEach` | Register a hook after each BDD test. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L722) |
| `assert` | Assert that a value is truthy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L304) |
| `assertEquals` | Assert that two values are deeply equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L289) |
| `assertExists` | Assert that a value is not null or undefined. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L309) |
| `assertGreater` | Assert that a number is greater than another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L380) |
| `assertGreaterOrEqual` | Assert that a number is greater than or equal to another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L385) |
| `assertInstanceOf` | Assert that a value is an instance of a constructor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L351) |
| `assertLess` | Assert that a number is less than another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L390) |
| `assertLessOrEqual` | Assert that a number is less than or equal to another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L395) |
| `assertMatch` | Assert that a string matches a regular expression. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L346) |
| `assertNotEquals` | Assert that two values are not deeply equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L294) |
| `assertNotStrictEquals` | Assert that two values are not strictly equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L366) |
| `assertObjectMatch` | Assert that an object contains matching properties. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L371) |
| `assertRejects` | Assert that an async function rejects. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L331) |
| `assertStrictEquals` | Assert that two values are strictly equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L299) |
| `assertStringIncludes` | Assert that a string contains another string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L341) |
| `assertThrows` | Assert that a synchronous function throws and return its captured value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L314) |
| `assertThrows` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L315) |
| `assertThrows` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L321) |
| `beforeAll` | Register a hook before all BDD tests in a group. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L732) |
| `beforeEach` | Register a hook before each BDD test. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L713) |
| `chmod` | Change file permissions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L409) |
| `createFileSystem` | Create file system. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L316) |
| `cwd` | Return the current working directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L21) |
| `deepEquals` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/utils.ts#L7) |
| `delay` | Wait for a duration in milliseconds. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L152) |
| `deleteEnv` | Delete a process environment variable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L235) |
| `describe` | Group related BDD tests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L599) |
| `env` | Read and write process environment variables. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L32) |
| `exists` | Check whether a path exists. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L348) |
| `exit` | Exit the current process. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L157) |
| `fail` | Fail the current assertion immediately. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L361) |
| `getArgs` | Get command-line arguments (cross-runtime: Deno.args or process.argv). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L5) |
| `getEnv` | Read an environment variable from the active project scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L139) |
| `getTestTimeScale` | Return test time scale. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L4) |
| `isAlreadyExistsError` | Error shape for is already exists. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L469) |
| `isNotFoundError` | Error shape for is not found. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L447) |
| `it` | Define a BDD test case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L655) |
| `makeTempDir` | Create temp dir. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L404) |
| `makeTempDirWithOptions` | Atomically create a uniquely named temporary directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L99) |
| `makeTempFile` | Atomically create a uniquely named temporary file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L49) |
| `mkdir` | Create a directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L382) |
| `readDir` | Read directory entries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L392) |
| `readFile` | Read a file as bytes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L333) |
| `readTextFile` | Read a file as text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L328) |
| `registerTestCleanup` | Register one cleanup invocation for the next comprehensive state reset. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/isolation.ts#L26) |
| `remove` | Remove a file or directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L387) |
| `resetAllTestState` | Comprehensive reset of ALL test state across the application. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/isolation.ts#L69) |
| `safeStringify` | Serialize unknown values safely for test output. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/utils.ts#L16) |
| `scaleMs` | Scale a duration for the current test runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L9) |
| `setEnv` | Sets env. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L215) |
| `stat` | Read file metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L353) |
| `testDelay` | Wait for a test-scaled duration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L15) |
| `waitFor` | Wait until a condition succeeds. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L128) |
| `withEnv` | Run a callback with an async-context-isolated environment overlay. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L246) |
| `withTempDir` | Run a callback with a temporary directory and reliably remove it afterward. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L167) |
| `withTempFile` | Run a callback with a temporary file and reliably remove it afterward. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L188) |
| `writeFile` | Write bytes to a file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L343) |
| `writeTextFile` | Write text to a file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L338) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `BddTestContext` | Context passed to hooks and tests (BDD-specific) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L30) |
| `TestOptions` | Test options for Deno sanitizers (ignored in Node/Bun) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L19) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `isBun` | True if running in Bun runtime (check first since Bun has process.versions.node) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L69) |
| `isDeno` | True if running in real Deno runtime (not dnt shim) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L75) |
| `isNode` | True if running in Node.js runtime (has process.versions.node, not Bun, not shimmed Deno) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L72) |
| `test` | Shared test value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L752) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/testing/assert`

```ts
import { assert, assertEquals, assertExists } from "veryfront/testing/assert";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `assert` | Assert that a value is truthy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L304) |
| `assertEquals` | Assert that two values are deeply equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L289) |
| `assertExists` | Assert that a value is not null or undefined. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L309) |
| `assertGreater` | Assert that a number is greater than another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L380) |
| `assertGreaterOrEqual` | Assert that a number is greater than or equal to another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L385) |
| `assertInstanceOf` | Assert that a value is an instance of a constructor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L351) |
| `assertLess` | Assert that a number is less than another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L390) |
| `assertLessOrEqual` | Assert that a number is less than or equal to another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L395) |
| `assertMatch` | Assert that a string matches a regular expression. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L346) |
| `assertNotEquals` | Assert that two values are not deeply equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L294) |
| `assertNotStrictEquals` | Assert that two values are not strictly equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L366) |
| `assertObjectMatch` | Assert that an object contains matching properties. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L371) |
| `assertRejects` | Assert that an async function rejects. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L331) |
| `assertStrictEquals` | Assert that two values are strictly equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L299) |
| `assertStringIncludes` | Assert that a string contains another string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L341) |
| `assertThrows` | Assert that a synchronous function throws and return its captured value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L314) |
| `assertThrows` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L315) |
| `assertThrows` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L321) |
| `fail` | Fail the current assertion immediately. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L361) |

### `veryfront/testing/bdd`

Portable BDD testing utilities (describe, it, beforeEach, afterEach). Delegates to `@std/testing/bdd` in Deno, `node:test` in Node.js, and `bun:test` in Bun. Each test gets an async-context environment overlay so concurrent tests cannot leak environment mutations into one another.

```ts
import { afterAll, afterEach, beforeAll } from "veryfront/testing/bdd";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `afterAll` | Register a hook after all BDD tests in a group. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L742) |
| `afterEach` | Register a hook after each BDD test. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L722) |
| `beforeAll` | Register a hook before all BDD tests in a group. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L732) |
| `beforeEach` | Register a hook before each BDD test. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L713) |
| `describe` | Group related BDD tests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L599) |
| `initBdd` | Initialize the BDD test adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L755) |
| `it` | Define a BDD test case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L655) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `BddTestContext` | Context passed to hooks and tests (BDD-specific) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L30) |
| `TestOptions` | Test options for Deno sanitizers (ignored in Node/Bun) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L19) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `test` | Shared test value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L752) |
