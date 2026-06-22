---
title: "veryfront/testing"
description: "Cross-runtime BDD assertions and test helpers."
order: 29
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
| `afterAll` | Register a hook after all BDD tests in a group. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L603) |
| `afterEach` | Register a hook after each BDD test. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L585) |
| `assert` | Assert that a value is truthy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L282) |
| `assertEquals` | Assert that two values are deeply equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L267) |
| `assertExists` | Assert that a value is not null or undefined. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L287) |
| `assertGreater` | Assert that a number is greater than another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L351) |
| `assertGreaterOrEqual` | Assert that a number is greater than or equal to another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L356) |
| `assertInstanceOf` | Assert that a value is an instance of a constructor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L322) |
| `assertLess` | Assert that a number is less than another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L361) |
| `assertLessOrEqual` | Assert that a number is less than or equal to another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L366) |
| `assertMatch` | Assert that a string matches a regular expression. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L317) |
| `assertNotEquals` | Assert that two values are not deeply equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L272) |
| `assertNotStrictEquals` | Assert that two values are not strictly equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L337) |
| `assertObjectMatch` | Assert that an object contains matching properties. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L342) |
| `assertRejects` | Assert that an async function rejects. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L302) |
| `assertStrictEquals` | Assert that two values are strictly equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L277) |
| `assertStringIncludes` | Assert that a string contains another string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L312) |
| `assertThrows` | Assert that a synchronous function throws. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L292) |
| `beforeAll` | Register a hook before all BDD tests in a group. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L594) |
| `beforeEach` | Register a hook before each BDD test. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L576) |
| `chmod` | Change file permissions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L326) |
| `createFileSystem` | Create file system. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L262) |
| `cwd` | Return the current working directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L20) |
| `deepEquals` | ********************* Shared utility functions for cross-runtime testing. ********************* | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/utils.ts#L4) |
| `delay` | Wait for a duration in milliseconds. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L122) |
| `deleteEnv` | Delete a process environment variable. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L212) |
| `describe` | Group related BDD tests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L463) |
| `env` | Read and write process environment variables. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L31) |
| `exists` | Check whether a path exists. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L294) |
| `exit` | Exit the current process. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L127) |
| `fail` | Fail the current assertion immediately. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L332) |
| `getArgs` | Get command-line arguments (cross-runtime: Deno.args or process.argv). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/lifecycle.ts#L4) |
| `getEnv` | Read an environment variable from the active project scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L116) |
| `getTestTimeScale` | Return test time scale. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L15) |
| `isAlreadyExistsError` | Error shape for is already exists. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L378) |
| `isNotFoundError` | Error shape for is not found. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L364) |
| `it` | Define a BDD test case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L518) |
| `makeTempDir` | Create temp dir. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L321) |
| `makeTempDirWithOptions` | Options accepted by make temp dir with. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L72) |
| `makeTempFile` | Create temp file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L47) |
| `mkdir` | Create a directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L304) |
| `readDir` | Read directory entries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L314) |
| `readFile` | Read a file as bytes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L279) |
| `readTextFile` | Read a file as text. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L274) |
| `registerTestCleanup` | Registers test cleanup. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/isolation.ts#L21) |
| `remove` | Remove a file or directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L309) |
| `resetAllTestState` | Comprehensive reset of ALL test state across the application. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/isolation.ts#L63) |
| `safeStringify` | Serialize unknown values safely for test output. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/utils.ts#L33) |
| `scaleMs` | Scale a duration for the current test runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L20) |
| `setEnv` | Sets env. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/process/env.ts#L192) |
| `stat` | Read file metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L299) |
| `testDelay` | Wait for a test-scaled duration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/timing.ts#L26) |
| `waitFor` | Wait until a condition succeeds. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L98) |
| `withEnv` | Applies env. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L185) |
| `withTempDir` | Applies temp dir. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L137) |
| `withTempFile` | Applies temp file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/deno-compat.ts#L161) |
| `writeFile` | Write bytes to a file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L289) |
| `writeTextFile` | Write text to a file. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/fs.ts#L284) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `BddTestContext` | Context passed to hooks and tests (BDD-specific) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L29) |
| `TestOptions` | Test options for Deno sanitizers (ignored in Node/Bun) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L18) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `isBun` | True if running in Bun runtime (check first since Bun has process.versions.node) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L63) |
| `isDeno` | True if running in real Deno runtime (not dnt shim) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L69) |
| `isNode` | True if running in Node.js runtime (has process.versions.node, not Bun, not shimmed Deno) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/compat/runtime.ts#L66) |
| `test` | Shared test value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L612) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/testing/assert`

```ts
import { assert, assertEquals, assertExists } from "veryfront/testing/assert";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `assert` | Assert that a value is truthy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L282) |
| `assertEquals` | Assert that two values are deeply equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L267) |
| `assertExists` | Assert that a value is not null or undefined. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L287) |
| `assertGreater` | Assert that a number is greater than another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L351) |
| `assertGreaterOrEqual` | Assert that a number is greater than or equal to another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L356) |
| `assertInstanceOf` | Assert that a value is an instance of a constructor. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L322) |
| `assertLess` | Assert that a number is less than another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L361) |
| `assertLessOrEqual` | Assert that a number is less than or equal to another number. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L366) |
| `assertMatch` | Assert that a string matches a regular expression. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L317) |
| `assertNotEquals` | Assert that two values are not deeply equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L272) |
| `assertNotStrictEquals` | Assert that two values are not strictly equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L337) |
| `assertObjectMatch` | Assert that an object contains matching properties. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L342) |
| `assertRejects` | Assert that an async function rejects. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L302) |
| `assertStrictEquals` | Assert that two values are strictly equal. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L277) |
| `assertStringIncludes` | Assert that a string contains another string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L312) |
| `assertThrows` | Assert that a synchronous function throws. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L292) |
| `fail` | Fail the current assertion immediately. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/assert.ts#L332) |

### `veryfront/testing/bdd`

Portable BDD testing utilities (describe, it, beforeEach, afterEach). In Deno: Direct re-export from @std/testing/bdd (no wrapper) In Node.js: Uses node:test In Bun: Uses bun:test

```ts
import { afterAll, afterEach, beforeAll } from "veryfront/testing/bdd";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `afterAll` | Register a hook after all BDD tests in a group. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L603) |
| `afterEach` | Register a hook after each BDD test. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L585) |
| `beforeAll` | Register a hook before all BDD tests in a group. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L594) |
| `beforeEach` | Register a hook before each BDD test. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L576) |
| `describe` | Group related BDD tests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L463) |
| `initBdd` | Initialize the BDD test adapter. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L615) |
| `it` | Define a BDD test case. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L518) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `BddTestContext` | Context passed to hooks and tests (BDD-specific) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L29) |
| `TestOptions` | Test options for Deno sanitizers (ignored in Node/Bun) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L18) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `test` | Shared test value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/testing/bdd.ts#L612) |
