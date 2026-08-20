---
title: "Author extensions"
description: "Write, test, and package a focused Veryfront extension."
order: 39
---

Use this guide when a runtime capability needs a reusable contract and lifecycle.
Keep the extension focused on one capability boundary.
Third-party SDKs and their concrete implementations belong in explicit `ext-*`
packages; dependency-free core code exposes only the provider-neutral contract
and must not import or auto-load the extension.

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

Extension metadata must be a plain object. Names are limited to 256 characters
and versions to 128; both must be trimmed, well-formed, single-line Unicode.

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
after async initialization. Declare every dynamically registered contract in
`contracts.provides`; setup fails closed if it publishes an undeclared contract.

```ts
const asyncAuthExtension: ExtensionFactory = () => ({
  name: "async-auth-extension",
  version: "1.0.0",
  capabilities: [],
  contracts: {
    provides: ["CurrentUserProvider"],
  },
  async setup(ctx) {
    const provider = await Promise.resolve({
      async getUser() {
        return null;
      },
    });
    ctx.provide("CurrentUserProvider", provider);
  },
});
```

Use either `contracts` or the legacy static `provides` object, never both.
Each `contracts.provides` or `contracts.requires` list is a dense array of at
most 256 unique names. Contract names are limited to 256 characters and must be
trimmed, well-formed, single-line Unicode. Veryfront snapshots this metadata
before replacing the active extension generation.

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

| Type              | Scope field          | Deno permission             |
| ----------------- | -------------------- | --------------------------- |
| `fs:read`         | `paths: string[]`    | `--allow-read[=paths]`      |
| `fs:write`        | `paths: string[]`    | `--allow-write[=paths]`     |
| `net:outbound`    | `hosts: string[]`    | `--allow-net[=hosts]`       |
| `net:listen`      | `host`, `ports[]`    | `--allow-net=host:port,...` |
| `env:read`        | `keys: string[]`     | `--allow-env[=keys]`        |
| `process:spawn`   | `commands: string[]` | `--allow-run[=commands]`    |
| `system:read`     | `apis: string[]`     | `--allow-sys[=apis]`        |
| `native:ffi`      | none                 | `--allow-ffi`               |
| `sandbox:execute` | `tools: string[]`    | Audit only                  |

Omitting a supported scope field explicitly requests the corresponding
unscoped Deno permission, except that `system:read` always requires a non-empty
`apis` array and never emits bare `--allow-sys`. If you provide another scope
field, it must be a non-empty array of trimmed strings. Scope values cannot
contain commas or control
characters, including Unicode C1 controls and line separators, because Deno
uses commas to separate permissions and these characters make command and
audit boundaries ambiguous. Scope strings must contain well-formed Unicode;
the same rule applies to every capability metadata key and string so audit
records remain single-line and unambiguous. Audit output JSON-quotes capability
types and field names. Raw capability text is limited to 32,768 UTF-8 bytes and
UTF-16 code units, and its rendered audit output to 49,152 of each. Veryfront
does not normalize filesystem paths. The combined serialized Deno permission
flags for one extension are limited to 8,192 UTF-8 bytes and 8,192 UTF-16 code
units so an accepted declaration remains launchable across supported operating
systems. For `net:listen`, `host` is valid only together with a non-empty
`ports` array.
Veryfront rejects unknown fields on recognized capability types so a typo such
as `path` instead of `paths` cannot silently broaden access.
System API scopes must use a `Deno.SysPermissionDescriptor.kind` supported by
the pinned Deno 2.7.7 runtime: `loadavg`, `hostname`, `systemMemoryInfo`,
`networkInterfaces`, `osRelease`, `osUptime`, `uid`, `gid`, `username`, `cpus`,
`homedir`, `statfs`, or `getPriority`. The `system:read` capability rejects
`setPriority` because that API changes process scheduling state.

Network scopes accept ASCII DNS names (including a leading `*.` wildcard),
canonical IPv4 addresses, and bracketed IPv6 addresses, with an optional port
for `net:outbound`. A sole outbound host of `"*"` explicitly requests an
unscoped `--allow-net` flag; it cannot be combined with narrower hosts. In Deno,
`*.example.com` grants both subdomains and the apex `example.com`; use explicit
hosts when apex access is not intended. Deno's single `--allow-net` permission
covers both outbound connections and listeners, so `net:outbound` versus
`net:listen` is auditable intent, not process-level directional isolation.

Capability declarations are metadata, not an in-process sandbox. An extension
loaded into the Veryfront process inherits that process's permissions.
`mapToDenoPermissions()` only serializes Deno flags; a subprocess launcher must
apply those flags for Deno to enforce them. Use a separate process plus a
container or operating-system policy when directional or stronger isolation is
required.

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

Preset metadata must be a dense array with at most 256 direct children.
Veryfront rejects graphs deeper than 32 levels or larger than 4,096 visited
nodes so malformed or cyclic composition cannot exhaust startup resources.

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
deno task test:file extensions/my-cache/src/
```

## Package the extension

Package an extension only when it needs reuse across projects.

1. Export the extension factory as the default export.
2. Set `veryfront.extension: true` in `deno.json`, `deno.jsonc`, or
   `package.json`.
3. Set `veryfront.activation` to `"auto"` or `"explicit"`.
4. Declare capabilities in package metadata and in the factory.
5. Declare contract metadata through `contracts` or static `provides`.
6. Include tests for the factory and contract implementation.
7. Publish to npm or JSR.

Users install the package and Veryfront discovers it:

```bash
deno add @myorg/ext-custom-cache
```

Use `"auto"` only when importing and setting up the package is safe merely
because it is installed. Use `"explicit"` for credentialed, native, or
side-effecting providers; Veryfront then ignores the installed package until
the project imports its factory and adds the resulting extension to
`veryfront.config.ts`. Omitting `activation` retains the legacy `"auto"`
behavior. Unknown or malformed activation metadata fails closed.

Use semver for releases. Treat contract shape changes as breaking changes.

## Verify it worked

1. Run `veryfront extension validate extensions/my-cache`.
2. Run `deno task test:file extensions/my-cache/src/`.
3. Add the factory to `veryfront.config.ts` and restart `veryfront dev`.
4. Confirm the dev log lists the extension under its declared name.
5. Resolve the contract from app code and confirm it uses the extension's
   implementation.

## Next

- [Extensions](./extensions.md): Enable an extension in a project

## Related

- [veryfront/extensions](../api-reference/veryfront/extensions.md): Extension APIs
- [veryfront/testing](../api-reference/veryfront/testing.md): Testing helpers
