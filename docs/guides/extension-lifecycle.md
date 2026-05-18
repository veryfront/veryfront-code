---
title: "Extension lifecycle"
description: "Understand extension discovery, ordering, presets, setup, and teardown."
order: 30
---

# Extension lifecycle

The extension lifecycle controls how Veryfront discovers, orders, starts, and stops extension factories.

## Load sequence

```text
discover -> flatten presets -> topological sort -> setup() -> runtime -> teardown()
```

1. Discovery finds configured, local, and package-provided extensions.
2. Presets expand into their child extensions.
3. Topological sort loads providers before consumers.
4. `setup()` runs in sorted order.
5. `teardown()` runs in reverse order during shutdown or reload.

## Presets

Use presets to group extensions that should usually be installed together:

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

Presets are flattened before ordering. Their children are treated as independent extensions for conflict detection and load order.

## Configuration

Pass configuration through the extension factory:

```ts
extRedis({ url: "redis://localhost:6379", prefix: "myapp:" });
```

Extensions can also read project config through `ctx.config` during `setup()`.

## Development reloads

During development, changes to `veryfront.config.ts` trigger teardown, rediscovery, and setup. Extensions must release resources in `teardown()` so reloads do not leak connections, timers, or file handles.

Verify reload behavior by adding a temporary log in the extension `setup()` and `teardown()` methods, then run:

```bash
veryfront dev
```

Save `veryfront.config.ts`. The dev server should run `teardown()` for the previous extension instance and `setup()` for the new one.

## Next

- [Extension testing](./extension-testing.md): test factories and contracts
- [Extension publishing](./extension-publishing.md): package reusable extensions

## Related

- [Extensions](./extensions.md): extension overview
- [Extension authoring](./extension-authoring.md): writing extension factories
- [`veryfront/extensions`](../reference/veryfront/extensions.md): extension API reference
