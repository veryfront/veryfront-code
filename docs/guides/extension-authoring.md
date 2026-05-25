---
title: "Author extensions"
description: "Write, test, and package a focused Veryfront extension."
order: 39
---

Use this guide when a runtime capability needs a reusable contract and lifecycle.
Keep the extension focused on one capability boundary.

Use [Extensions](./extensions.md) when you only need to enable an existing
extension.

## Prerequisites

- A Veryfront project that imports `veryfront/extensions`.
- A concrete capability gap to fill.
- `deno` available on your PATH.

## Scaffold an extension

```bash
veryfront extension init my-cache
```

This creates a local package:

```text
extensions/
  my-cache/
    src/
      index.ts
      index.test.ts
    deno.json
```

Validate the extension shape:

```bash
veryfront extension validate extensions/my-cache
```

For first-party extensions in the Veryfront monorepo, use an `ext-` directory
prefix. The capability and contract audit tasks only check extension directories
with that prefix. Local downstream extensions do not need it.

## Write the factory

```ts
import type { ExtensionFactory } from "veryfront/extensions";

const myExtension: ExtensionFactory = () => ({
  name: "my-extension",
  version: "1.0.0",
  capabilities: [],
});

export default myExtension;
```

## Provide a contract

Use `provides` when the implementation does not need async setup:

```ts
import type { ExtensionFactory } from "veryfront/extensions";

interface CurrentUserProvider {
  getUser(): Promise<{ id: string } | null>;
}

const currentUserProvider: CurrentUserProvider = {
  async getUser() {
    return null;
  },
};

const authExtension: ExtensionFactory = () => ({
  name: "auth-extension",
  version: "1.0.0",
  capabilities: [],
  provides: {
    CurrentUserProvider: currentUserProvider,
  },
});

export default authExtension;
```

Use `setup(ctx)` when the implementation opens resources or registers contracts
after async initialization.

## Declare capabilities

Capabilities document runtime needs. Use a recognized `type` and matching scope
field so Veryfront can map the capability to a Deno permission flag and audit it
in CI.

```ts
const extension: ExtensionFactory = () => ({
  name: "redis-cache",
  version: "1.0.0",
  capabilities: [
    { type: "net:outbound", hosts: ["redis.example.com"] },
    { type: "env:read", keys: ["REDIS_URL"] },
  ],
});
```

Common capability types:

| Type | Scope field | Deno permission |
| --- | --- | --- |
| `fs:read` | `paths: string[]` | `--allow-read[=paths]` |
| `fs:write` | `paths: string[]` | `--allow-write[=paths]` |
| `net:outbound` | `hosts: string[]` | `--allow-net[=hosts]` |
| `net:listen` | `host`, `ports[]` | `--allow-net=host:port,...` |
| `env:read` | `keys: string[]` | `--allow-env[=keys]` |
| `process:spawn` | `commands: string[]` | `--allow-run[=commands]` |
| `native:ffi` | none | `--allow-ffi` |
| `sandbox:execute` | `tools: string[]` | Audit only |

For first-party extensions, mirror the same `capabilities` array in `deno.json`
under `veryfront.capabilities`.

## Understand load order

Veryfront loads extensions in this order:

```text
discover -> flatten presets -> topological sort -> setup() -> runtime -> teardown()
```

Providers load before consumers. `setup()` runs in sorted order. `teardown()`
runs in reverse order during shutdown or reload.

Use presets to group extensions that load together:

```ts
import type { ExtensionFactory } from "veryfront/extensions";

const webPreset: ExtensionFactory = () => ({
  name: "web-preset",
  version: "1.0.0",
  capabilities: [],
  extends: [
    authExtension(),
    cacheExtension(),
  ],
});

export default webPreset;
```

During development, changes to `veryfront.config.ts` trigger teardown,
rediscovery, and setup. Release resources in `teardown()` so reloads do not leak
connections, timers, or file handles.

## Test the extension

Test the factory first:

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

Then test the contract through the extension loader:

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

Run the tests:

```bash
deno test --no-check --allow-all extensions/my-cache/src/
```

## Package the extension

Package an extension only when it needs reuse across projects.

1. Export the extension factory as the default export.
2. Set `veryfront.extension: true` in `deno.json` or `package.json`.
3. Declare capabilities in package metadata and in the factory.
4. Declare contract metadata through `contracts` or static `provides`.
5. Include tests for the factory and contract implementation.
6. Publish to npm or JSR.

Users install the package and Veryfront discovers it:

```bash
deno add @myorg/ext-custom-cache
```

Use semver for releases. Treat contract shape changes as breaking changes.

## Verify it worked

1. Run `veryfront extension validate extensions/my-cache`.
2. Run `deno test --no-check --allow-all extensions/my-cache/src/`.
3. Add the factory to `veryfront.config.ts` and restart `veryfront dev`.
4. Confirm the dev log lists the extension under its declared name.
5. Resolve the contract from app code and confirm it uses the extension's
   implementation.

## Next

- [Extensions](./extensions.md): Enable an extension in a project

## Related

- [veryfront/extensions](../api-reference/veryfront/extensions.md): Extension APIs
- [veryfront/testing](../api-reference/veryfront/testing.md): Testing helpers
