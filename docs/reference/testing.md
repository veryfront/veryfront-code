---
title: "veryfront/testing"
description: "Cross-runtime BDD, assertion, isolation, filesystem, environment, and timing test utilities."
order: 26
---

# veryfront/testing

Cross-runtime BDD, assertion, isolation, filesystem, environment, and timing test utilities.

## Examples

```ts
import { assertEquals, describe, it } from "veryfront/testing";

describe("math", () => {
  it("adds numbers", () => {
    assertEquals(1 + 1, 2);
  });
});
```

## API groups

| Group                   | Exports                                                                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BDD                     | `describe()`, `it()`, `test()`, `beforeAll()`, `beforeEach()`, `afterEach()`, `afterAll()`                                                                                                                                                                    |
| Assertions              | `assert()`, `assertEquals()`, `assertNotEquals()`, `assertStrictEquals()`, `assertNotStrictEquals()`, `assertExists()`, `assertInstanceOf()`, `assertStringIncludes()`, `assertMatch()`, `assertObjectMatch()`, `assertThrows()`, `assertRejects()`, `fail()` |
| Comparisons             | `assertGreater()`, `assertGreaterOrEqual()`, `assertLess()`, `assertLessOrEqual()`                                                                                                                                                                            |
| Isolation               | `registerTestCleanup()`, `resetAllTestState()`                                                                                                                                                                                                                |
| Deno-compatible helpers | `env`, `getEnv()`, `setEnv()`, `deleteEnv()`, `withEnv()`, `cwd()`, `getArgs()`, `exit()`, file and directory helpers, temp-file helpers, `delay()`, and `waitFor()`                                                                                          |
| Timing                  | `getTestTimeScale()`, `scaleMs()`, `testDelay()`                                                                                                                                                                                                              |
| Runtime flags           | `isDeno`, `isNode`, `isBun`                                                                                                                                                                                                                                   |

Import from `veryfront/testing` for normal tests. Import from
`veryfront/testing/assert` or `veryfront/testing/bdd` only when a narrow public
subpath is useful.
