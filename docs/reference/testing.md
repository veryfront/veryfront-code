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
