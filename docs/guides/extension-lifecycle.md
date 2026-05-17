---
title: "Extension Lifecycle"
description: "Understand extension discovery, ordering, presets, setup, and teardown."
order: 26
---

# Extension Lifecycle

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

## Related

- [Extensions](./extensions.md) - extension overview
- [Extension authoring](./extension-authoring.md) - writing extension factories
- [`veryfront/extensions`](../reference/extensions.md) - extension API reference
