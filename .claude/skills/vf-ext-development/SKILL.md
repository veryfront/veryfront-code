---
name: vf-ext-development
description: Use when creating, modifying, testing, or publishing a Veryfront extension under extensions/ — covers manifest/factory parity, capability types, contract registration, teardown hygiene, and CI lint checks
---

# Veryfront Extension Development

## Overview

A Veryfront extension is a `deno.json`-described package that default-exports an `ExtensionFactory`. The factory returns an object that declares its contracts, declares its capabilities, and optionally provides implementations through static `provides` or dynamic `setup(ctx)`.

**Core principle:** The manifest and the factory must agree. CI fails the build if `veryfront.contracts` / `veryfront.capabilities` in `deno.json` drift from what the factory returns.

## When to Use

- Creating a new extension under `extensions/`
- Adding/removing a contract or capability on an existing extension
- Adding a new contract type to the framework (also touches the recommendations registry and the extensions README)
- Writing tests for an extension factory or its contract implementation
- Triaging `lint:extension-contracts` / `lint:extension-capabilities` failures

## Scaffold

```bash
veryfront extension init ext-my-cache       # writes extensions/ext-my-cache/{deno.json,src/index.ts,src/index.test.ts}
veryfront extension validate extensions/ext-my-cache
```

**Always use the `ext-` prefix.** `scripts/lint/audit-extension-{capabilities,contracts}.ts` only scan directories whose name starts with `ext-`; an extension at `extensions/my-cache/` is silently skipped by both lint tasks. `veryfront extension init` does not add the prefix for you — pass it explicitly.

## Package Structure

```
extensions/ext-<name>/
├── deno.json         # Manifest — name, contracts, capabilities, imports
├── README.md         # Required for first-party extensions
└── src/
    ├── index.ts      # Default-exported ExtensionFactory
    ├── index.test.ts # Factory + setup/teardown tests
    └── <impl>.ts     # Implementation modules + colocated *.test.ts
```

## Manifest (deno.json)

```json
{
  "name": "@veryfront/ext-cache-redis",
  "version": "0.1.0",
  "exports": "./src/index.ts",
  "veryfront": {
    "extension": true,
    "contracts": { "provides": ["TokenCacheStore"], "requires": [] },
    "capabilities": [
      { "type": "net:outbound", "hosts": ["*"] },
      { "type": "env:read", "keys": ["REDIS_URL", "REDIS_PREFIX", "REDIS_PASSWORD"] }
    ]
  },
  "imports": {
    "redis": "npm:redis@5.11.0",
    "veryfront/extensions": "../../src/extensions/index.ts",
    "veryfront/extensions/cache": "../../src/extensions/cache/index.ts"
  }
}
```

**Required:**

- `"name": "@veryfront/ext-<name>"` for first-party; lowercase, hyphens only.
- `"veryfront.extension": true` — without this flag, discovery skips the package.
- `"veryfront.contracts.provides"` / `"requires"` — must exactly match the factory return value (sorted, deduped).
- `"veryfront.capabilities"` — must exactly match the factory return value.
- `"imports"` map — list every `veryfront/...` specifier the extension actually imports (`veryfront/extensions` for `ExtensionFactory`, and any sub-paths like `veryfront/extensions/cache` for cross-area contract types). The corpus is mixed: some extensions omit the root `veryfront/extensions` entry when they only import via a sub-path; safer to list every specifier you use.

**Also:** Add the extension to the root `deno.json` `workspace` array (`"./extensions/ext-<name>"`).

## Factory shape

```ts
import type { ExtensionFactory } from "veryfront/extensions";

const extCacheRedis: ExtensionFactory = () => {
  let store: RedisTokenCacheStore | null = null;

  return {
    name: "ext-cache-redis",
    version: "0.1.0",
    contracts: { provides: ["TokenCacheStore"] },
    capabilities: [
      { type: "net:outbound", hosts: ["*"] },
      { type: "env:read", keys: ["REDIS_URL", "REDIS_PREFIX", "REDIS_PASSWORD"] },
    ],

    async setup(ctx) {
      const url = readConfig(ctx.config).url ?? readEnv("REDIS_URL");
      if (!url) {
        ctx.logger.info("[ext-cache-redis] REDIS_URL not configured — skipping registration");
        return;
      }
      store = new RedisTokenCacheStore({ url }, { logger: ctx.logger });
      ctx.provide("TokenCacheStore", store);
      ctx.logger.info(`[ext-cache-redis] TokenCacheStore registered (url=${redactUrl(url)})`);
    },

    async teardown() {
      if (store) {
        try {
          await store.close();
        } finally {
          store = null;
        }
      }
    },
  };
};

export default extCacheRedis;
```

**Rules:**

- Default export is the factory (a function), not the extension object.
- `name`, `version`, `capabilities` are required. Empty `capabilities: []` is valid.
- `contracts.provides` is what `setup()` will register via `ctx.provide()` — list it even though `ctx.provide()` works at runtime, because the lint task checks manifest ↔ factory parity.
- `contracts.requires` lists contracts you will `ctx.require()` — providers load before consumers via topological sort.

## Capability types — use these names

Docs in `docs/guides/extension-authoring.md` are out of date in places; the names below come from `src/extensions/capabilities.ts` and are what CI checks.

| Type              | Scope field          | Maps to Deno permission       |
| ----------------- | -------------------- | ----------------------------- |
| `fs:read`         | `paths: string[]`    | `--allow-read[=paths]`        |
| `fs:write`        | `paths: string[]`    | `--allow-write[=paths]`       |
| `net:outbound`    | `hosts: string[]`    | `--allow-net[=hosts]`         |
| `net:listen`      | `host`, `ports[]`    | `--allow-net=host:port,...`   |
| `env:read`        | `keys: string[]`     | `--allow-env[=keys]`          |
| `process:spawn`   | `commands: string[]` | `--allow-run[=commands]`      |
| `native:ffi`      | —                    | `--allow-ffi`                 |
| `sandbox:execute` | `tools: string[]`    | (audit-only, no Deno mapping) |

Custom types are allowed (logged for audit) but get no permission mapping.

**Never use** `{ type: "contract" }` — `lint:extension-contracts` fails. Declare contracts via `veryfront.contracts` instead.

## Static `provides` vs dynamic `setup(ctx.provide)`

```ts
// Static: synchronous, no other contracts needed, no init work.
provides: {
  CurrentUserProvider: { async getUser() { return null; } },
}

// Dynamic: async init, needs ctx.config / ctx.require, or conditional registration.
contracts: { provides: ["TokenCacheStore"] },
async setup(ctx) {
  const impl = await build(ctx.config);
  ctx.provide("TokenCacheStore", impl);
}
```

Don't combine — pick one mechanism per contract.

## Sensitive extension policies

If your extension matches one of these classes, the capability set is enforced exactly (see `scripts/lint/audit-extension-capabilities.ts`):

| Extension                         | Required capabilities                                 |
| --------------------------------- | ----------------------------------------------------- |
| `ext-sandbox-shell-tools`         | `sandbox:execute` with `tools: ["bash"]`              |
| `ext-cache-redis`                 | `net:outbound hosts:["*"]`, `env:read keys:[REDIS_*]` |
| `ext-db-sqlite`                   | `fs:read`, `fs:write`                                 |
| `ext-document-kreuzberg`          | `fs:read`                                             |
| `ext-observability-opentelemetry` | `net:outbound hosts:["*"]`, `env:read keys:[OTEL_*]`  |

Adding/removing a sensitive dep also requires keeping it inside its named extension boundary — `lint:dependency-boundaries` enforces this.

**Adding a new sensitive-class extension:** append a new entry to `SENSITIVE_EXTENSION_CAPABILITY_POLICIES` in `scripts/lint/audit-extension-capabilities.ts` (label, manifest path, exact capabilities) so the policy is enforced. The existing entries are the template — match their shape.

## Logging & secrets

- Use `ctx.logger.{debug,info,warn,error}` — never `console.log`.
- Prefix every line with the extension name: `[ext-<name>] ...`.
- Redact credentials before logging URLs:

```ts
function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.username = "";
    u.password = "";
    return u.toString();
  } catch {
    return "<redacted>";
  }
}
```

## Imports inside extension source

- Framework types: `import type { ExtensionFactory } from "veryfront/extensions";` (resolved by the extension's local `imports` map).
- Cross-module contracts: `import type { TokenCacheStore } from "veryfront/extensions/cache";`.
- Tests inside `src/`: `import { describe, it } from "#veryfront/testing/bdd.ts";` works because the root `deno.json` defines the `#veryfront/*` hash imports.

Do **not** import from `../../src/...` directly — go through the alias.

## Tests

Cover three things in `src/index.test.ts`:

```ts
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ExtensionContext, ExtensionLogger } from "veryfront/extensions";
import factory from "./index.ts";

const silentLogger: ExtensionLogger = { debug() {}, info() {}, warn() {}, error() {} };

function buildCtx(config: Record<string, unknown>, provides = new Map()): ExtensionContext {
  return {
    get: (n) => provides.get(n),
    require: (n) => {
      const v = provides.get(n);
      if (v === undefined) throw new Error(n);
      return v;
    },
    provide: (n, impl) => {
      provides.set(n, impl);
    },
    config,
    logger: silentLogger,
  };
}

describe("ext-<name>", () => {
  it("declares name/version/contracts/capabilities", () => {
    const ext = factory();
    assertEquals(ext.name, "ext-<name>");
    assertEquals(ext.contracts?.provides, ["MyContract"]);
    assertEquals(ext.capabilities.length > 0, true);
  });

  it("registers the contract on setup and releases on teardown", async () => {
    const ext = factory();
    const provides = new Map();
    await ext.setup!(buildCtx({/* config */}, provides));
    assertExists(provides.get("MyContract"));
    await ext.teardown!();
  });
});
```

**Patterns to follow:**

- Silent logger by default; a `capturingLogger()` helper only when asserting log content.
- Stub external clients via a `clientFactory` constructor option — never hit a real network from unit tests.
- Save/restore env vars: `const prev = Deno.env.get(K); try { ... } finally { prev === undefined ? Deno.env.delete(K) : Deno.env.set(K, prev); }`.
- Teardown must be idempotent (the redis store calls `close()` twice in its test on purpose).

## Adding a NEW contract type (framework-level)

When introducing a contract that has not existed before:

1. Define the contract interface under `src/extensions/<area>/` and export it from the area's `index.ts`.
2. Add the `veryfront/extensions/<area>` entry to root `deno.json` `imports`.
3. Add the contract → package mapping to `src/extensions/recommendations.ts` so the "Missing extension for contract X" error suggests the right install command.
4. If first-party: add a catalog row to `extensions/README.md` under the right section and a row to the "Contract requirements" table.
5. If the extension should auto-enable, register it in `src/extensions/builtin-extensions.ts`.

## Verification

```bash
deno task lint:extension-contracts        # manifest ↔ factory contract parity
deno task lint:extension-capabilities     # manifest ↔ factory capability parity + sensitive policies
deno task lint:dependency-boundaries      # sensitive deps stay inside named extensions
deno task test:scripts                    # runs audit-extension-*.test.ts
deno test --no-check --allow-all extensions/ext-<name>/src/
veryfront extension validate extensions/ext-<name>
```

A clean extension passes all six.

## Common Mistakes

| Mistake                                                                | Fix                                                                                      |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Capabilities only in factory (or only in manifest)                     | Mirror them in both; CI compares sorted/normalized values                                |
| `{ type: "network" }` / `{ type: "env" }` from the doc                 | Use `net:outbound`/`hosts` and `env:read`/`keys` (code names)                            |
| `{ type: "contract", ... }` in capabilities                            | Move to `veryfront.contracts.provides/requires`                                          |
| Missing `veryfront.extension: true` in manifest                        | Add it — discovery skips packages without the flag                                       |
| Missing `imports` map in extension's deno.json                         | Add `veryfront/extensions` → `../../src/extensions/index.ts`                             |
| New extension not in root workspace array                              | Add `"./extensions/ext-<name>"` to root `deno.json`                                      |
| Extension directory missing `ext-` prefix (e.g. `extensions/my-cache`) | Rename to `extensions/ext-my-cache` — lint scripts only scan `ext-*` directories         |
| Throwing on missing config in `setup()`                                | Log and return — let the contract stay unregistered so consumers fall back               |
| Logging raw URLs / secrets                                             | `redactUrl()` before any `ctx.logger.info` that includes a URL                           |
| `console.log` in extension code                                        | `ctx.logger.{info,warn,error}` with `[ext-<name>]` prefix                                |
| Holding resources without `teardown()`                                 | Implement `teardown()` — dev reload tears down + sets up again, leaks accumulate         |
| Combining static `provides` and `ctx.provide()` for the same contract  | Pick one per contract                                                                    |
| Default export = the extension object instead of the factory           | Default export must be the factory function                                              |
| Missing `recommendations.ts` entry for a new contract                  | Add the contract → `@veryfront/ext-*` mapping so missing-extension errors are actionable |
| Importing `../../src/...` from extension source                        | Use the `veryfront/extensions[/<area>]` alias from the local imports map                 |
| Test leaves `REDIS_URL` (etc.) set                                     | Save the prior value, set/delete inside `try`, restore in `finally`                      |
