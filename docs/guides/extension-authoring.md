---
title: "Extension authoring"
description: "Write focused Veryfront extension factories, contracts, and capabilities."
order: 38
---

An extension should address one capability boundary. Keep the factory small, declare requirements explicitly, and expose contracts through `provides` or `setup()`.

## Prerequisites

- A Veryfront project that imports `veryfront/extensions`.
- A concrete capability gap to fill: write the extension that fills exactly
  that gap rather than a general-purpose toolkit.

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

For a **first-party** extension that lives in the Veryfront monorepo, use an `ext-` prefix on the directory name (e.g. `veryfront extension init ext-my-cache`). The capability and contract audits in `scripts/lint/audit-extension-{capabilities,contracts}.ts` only scan directories whose name starts with `ext-`; an extension named without the prefix is silently excluded from those CI gates. The prefix is optional for local extensions inside a downstream project.

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

Use `setup(ctx)` when the implementation needs async initialization or dynamic contract registration.

## Declare capabilities

Capabilities document what the extension needs at runtime. The `type` string and its scope field both come from `src/extensions/capabilities.ts` — these are also the names the Deno permission map and the CI capability audit recognize.

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

Recognized capability types:

| Type              | Scope field          | Deno permission               |
| ----------------- | -------------------- | ----------------------------- |
| `fs:read`         | `paths: string[]`    | `--allow-read[=paths]`        |
| `fs:write`        | `paths: string[]`    | `--allow-write[=paths]`       |
| `net:outbound`    | `hosts: string[]`    | `--allow-net[=hosts]`         |
| `net:listen`      | `host`, `ports[]`    | `--allow-net=host:port,...`   |
| `env:read`        | `keys: string[]`     | `--allow-env[=keys]`          |
| `process:spawn`   | `commands: string[]` | `--allow-run[=commands]`      |
| `native:ffi`      | —                    | `--allow-ffi`                 |
| `sandbox:execute` | `tools: string[]`    | (audit-only, no Deno mapping) |

For first-party extensions, also mirror the same `capabilities` array in `deno.json` under `veryfront.capabilities`; `deno task lint:extension-capabilities` fails the build if the two drift.

## Verify it worked

1. Run `veryfront extension validate extensions/my-cache`. A passing
   extension prints no errors.
2. Add the factory to `veryfront.config.ts` and restart `veryfront dev`.
   The dev log should list the extension under its declared name.
3. Use the contract from another part of the app and confirm the
   extension's `provides` value is what gets resolved.

## Next

- [Extension lifecycle](./extension-lifecycle.md): understand discovery and loading
- [Extension testing](./extension-testing.md): test factories and contracts

## Related

- [Extensions](./extensions.md): extension overview
- [`veryfront/extensions`](../reference/veryfront/extensions.md): extension API reference
