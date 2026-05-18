---
title: "Extension authoring"
description: "Write focused Veryfront extension factories, contracts, and capabilities."
order: 29
---

# Extension authoring

An extension should address one capability boundary. Keep the factory small, declare requirements explicitly, and expose contracts through `provides` or `setup()`.

## Scaffold an extension

```bash
veryfront extension init my-cache
```

This creates a local extension package:

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

## Write a factory

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

Use `provides` when the implementation does not need async initialization:

```ts
import type { ExtensionFactory } from "veryfront/extensions";
import type { AuthProvider } from "veryfront/extensions/auth";

const authProvider: AuthProvider = {
  async getUser() {
    return null;
  },
};

const authExtension: ExtensionFactory = () => ({
  name: "auth-extension",
  version: "1.0.0",
  capabilities: [],
  provides: {
    AuthProvider: authProvider,
  },
});

export default authExtension;
```

Use `setup(ctx)` when the implementation needs async initialization or dynamic contract registration.

## Declare capabilities

Capabilities document what the extension needs:

```ts
const extension: ExtensionFactory = () => ({
  name: "redis-cache",
  version: "1.0.0",
  capabilities: [
    { type: "network", hosts: ["redis.example.com"] },
    { type: "env", names: ["REDIS_URL"] },
  ],
});
```

## Next

- [Extension lifecycle](./extension-lifecycle.md): understand discovery and loading
- [Extension testing](./extension-testing.md): test factories and contracts

## Related

- [Extensions](./extensions.md): extension overview
- [`veryfront/extensions`](../reference/veryfront/extensions.md): extension API reference
