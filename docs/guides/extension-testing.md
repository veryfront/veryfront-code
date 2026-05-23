---
title: "Extension testing"
description: "Test Veryfront extension factories and contract implementations."
order: 41
---

Extension tests should prove that the factory returns a valid extension and that provided contracts work through the extension loader.

## Prerequisites

- An extension factory under test (see
  [Extension authoring](./extension-authoring.md)).
- `deno` available on your PATH.

## Factory test

```ts
import { assertEquals } from "veryfront/testing/assert";
import { describe, it } from "veryfront/testing/bdd";
import factory from "./index.ts";

describe("my-cache extension", () => {
  it("creates a valid extension", () => {
    const extension = factory({ maxSize: 100 });
    assertEquals(extension.name, "my-cache");
    assertEquals(extension.version, "1.0.0");
    assertEquals(Array.isArray(extension.capabilities), true);
  });
});
```

## Contract test

```ts
import { assertEquals, assertExists } from "veryfront/testing/assert";
import { afterEach, describe, it } from "veryfront/testing/bdd";
import { ExtensionLoader, tryResolve } from "veryfront/extensions";
import type { CacheStore } from "veryfront/extensions/cache";
import factory from "./index.ts";

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("my-cache contract", () => {
  const loader = new ExtensionLoader(noopLogger);

  afterEach(async () => {
    await loader.teardownAll();
  });

  it("provides CacheStore", async () => {
    await loader.setupAll(
      [{ extension: factory(), source: "config", origin: "test" }],
      {},
    );

    const cache = tryResolve<CacheStore>("CacheStore");
    assertExists(cache);

    await cache.set("key", "value", 60);
    assertEquals(await cache.get("key"), "value");
  });
});
```

## Run tests

```bash
deno test --no-check --allow-all extensions/my-cache/src/
```

## Verify it worked

A working test suite ends with `0 failures` and prints a successful count
for both the factory test and the contract test. If `tryResolve` returns
`undefined`, check that the extension's `provides` block uses the same
contract name (`"CacheStore"`) the consumer requests.

## Next

- [Extension publishing](./extension-publishing.md): package reusable extensions
- [Building and deploying](./deploying.md): production builds and deployment

## Related

- [Extension authoring](./extension-authoring.md): writing extension factories
- [`veryfront/testing`](../api-reference/veryfront/testing.md): testing API reference
