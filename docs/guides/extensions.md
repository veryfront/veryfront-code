---
title: "Extensions"
description: "Build custom extensions to add capabilities, integrate third-party services, and share reusable functionality."
order: 21
---

# Extensions

Build custom extensions to add capabilities, integrate third-party services, and share reusable functionality.

Veryfront's extension system uses a **contract-based architecture**: core defines interfaces (contracts), and extensions provide implementations. This keeps the core lightweight while enabling an open ecosystem of pluggable functionality.

## Concepts

| Term           | Description                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| **Contract**   | A TypeScript interface (e.g., `CacheStore`, `AuthProvider`) that defines a capability's API surface. |
| **Extension**  | A module that implements one or more contracts and declares its system requirements.                 |
| **Factory**    | A function that accepts optional config and returns an `Extension` object.                           |
| **Capability** | A declared system resource requirement (filesystem, network, env vars).                              |

## Quickstart: scaffold an extension

```bash
veryfront extension init my-cache
```

This creates:

```
extensions/
  my-cache/
    src/
      index.ts          # Extension factory (default export)
      index.test.ts     # Tests
    deno.json           # Package metadata
```

Validate your extension:

```bash
veryfront extension validate extensions/my-cache
```

## Writing an extension

An extension is a module that `export default`s an `ExtensionFactory` (a function returning an `Extension` object):

```ts
import type { ExtensionFactory } from "veryfront/extensions";

const myExtension: ExtensionFactory = (config?) => ({
  name: "my-extension",
  version: "1.0.0",
  capabilities: [],
});

export default myExtension;
```

### The Extension interface

```ts
interface Extension {
  name: string;
  version: string;
  capabilities: Capability[];
  setup?(ctx: ExtensionContext): Promise<void> | void;
  teardown?(): Promise<void> | void;
  provides?: Record<string, unknown>;
  extends?: Extension[];
}
```

| Field          | Required | Description                                                            |
| -------------- | -------- | ---------------------------------------------------------------------- |
| `name`         | Yes      | Unique identifier (lowercase, hyphens).                                |
| `version`      | Yes      | Semver string.                                                         |
| `capabilities` | Yes      | System resources the extension needs (can be empty `[]`).              |
| `provides`     | No       | Static contract implementations (registered before `setup` runs).      |
| `setup`        | No       | Async initialization. Connect to services, register dynamic contracts. |
| `teardown`     | No       | Cleanup. Close connections, flush buffers. Runs in reverse load order. |
| `extends`      | No       | Compose other extensions as a preset.                                  |

## Providing contracts

There are two ways to register a contract implementation:

### Static provides (simple cases)

Use the `provides` field when the implementation has no async initialization:

```ts
import type { ExtensionFactory } from "veryfront/extensions";
import type { AuthProvider } from "veryfront/extensions/auth";

const extJwt: ExtensionFactory = (config?) => {
  const provider = createAuthProvider(config);

  return {
    name: "ext-auth-jwt",
    version: "0.1.0",
    capabilities: [
      { type: "contract", name: "AuthProvider" },
    ],
    provides: {
      AuthProvider: provider,
    },
  };
};

export default extJwt;
```

### Dynamic provides (async setup)

Use `ctx.provide()` inside `setup()` when initialization requires async work, config reading, or conditional registration:

```ts
import type { ExtensionFactory } from "veryfront/extensions";

const extRedis: ExtensionFactory = () => {
  let store: RedisStore | null = null;

  return {
    name: "ext-cache-redis",
    version: "0.1.0",
    capabilities: [
      { type: "contract", name: "TokenCacheStore" },
      { type: "net:outbound", hosts: ["*"] },
    ],

    async setup(ctx) {
      const url = ctx.config.redisUrl as string | undefined;
      if (!url) {
        ctx.logger.info("[ext-cache-redis] No REDIS_URL, skipping");
        return;
      }

      store = new RedisStore(url);
      await store.connect();
      ctx.provide("TokenCacheStore", store);
      ctx.logger.info("[ext-cache-redis] TokenCacheStore registered");
    },

    async teardown() {
      await store?.disconnect();
      store = null;
    },
  };
};

export default extRedis;
```

## Consuming contracts

Extensions can depend on contracts provided by other extensions. Declare the dependency in `capabilities`, then resolve it in `setup()`:

```ts
import type { ExtensionFactory } from "veryfront/extensions";
import type { LLMProviderRegistry } from "veryfront/extensions/llm";
import { LLMProviderRegistryName } from "veryfront/extensions/llm";

const extMyProvider: ExtensionFactory = () => {
  let registry: LLMProviderRegistry | undefined;

  return {
    name: "ext-my-provider",
    version: "0.1.0",
    capabilities: [{ type: "contract", name: "LLMProvider:my-provider" }],

    setup(ctx) {
      registry = ctx.require<LLMProviderRegistry>(LLMProviderRegistryName);
      registry.register(myProvider);
    },

    teardown() {
      registry?.unregister(myProvider.id);
      registry = undefined;
    },
  };
};

export default extMyProvider;
```

The `capabilities: [{ type: "contract", name: "..." }]` declaration tells the topological sort that this extension consumes a contract. When the provider uses a static `provides` field, the sort guarantees providers load before consumers. For contracts registered dynamically via `ctx.provide()`, ensure the provider is listed earlier in the config or has higher source priority.

### ExtensionContext API

| Method                           | Description                                                |
| -------------------------------- | ---------------------------------------------------------- |
| `ctx.get<T>(contract)`           | Resolve a contract. Returns `undefined` if not registered. |
| `ctx.require<T>(contract)`       | Resolve a contract. Throws if not registered.              |
| `ctx.provide<T>(contract, impl)` | Register a contract implementation.                        |
| `ctx.config`                     | Read-only access to the project's resolved config.         |
| `ctx.logger`                     | Structured logger (`debug`, `info`, `warn`, `error`).      |

## Declaring capabilities

Capabilities declare what system resources your extension needs. On Deno, these map to runtime permissions. On Node/Bun, they're logged for audit transparency.

```ts
capabilities: [
  { type: "fs:read", paths: ["./src", "./public"] },
  { type: "fs:write", paths: ["./dist"] },
  { type: "net:outbound", hosts: ["api.example.com"] },
  { type: "net:listen", ports: [3000] },
  { type: "env:read", keys: ["DATABASE_URL", "API_KEY"] },
  { type: "process:spawn", commands: ["esbuild"] },
  { type: "contract", name: "CacheStore" },
];
```

| Type            | Scoping              | Deno flag                         |
| --------------- | -------------------- | --------------------------------- |
| `fs:read`       | `paths: string[]`    | `--allow-read=<paths>`            |
| `fs:write`      | `paths: string[]`    | `--allow-write=<paths>`           |
| `net:outbound`  | `hosts: string[]`    | `--allow-net=<hosts>`             |
| `net:listen`    | `ports: number[]`    | `--allow-net=localhost:<port>`    |
| `env:read`      | `keys: string[]`     | `--allow-env=<keys>`              |
| `process:spawn` | `commands: string[]` | `--allow-run=<commands>`          |
| `native:ffi`    | (none)               | `--allow-ffi`                     |
| `contract`      | `name: string`       | (ordering hint, not a permission) |

## Available contracts

These are first-party contracts your extension can implement or consume. Some implementations are auto-enabled by core bootstrap. Contracts without a default package are extension points for project or third-party providers.

| Contract                    | Description                          | Default package                                |
| --------------------------- | ------------------------------------ | ---------------------------------------------- |
| `AuthProvider`              | JWT sign/verify/decode               | `@veryfront/ext-auth-jwt`                      |
| `Bundler`                   | JS/TS bundling and transforms        | `@veryfront/ext-bundler-esbuild`               |
| `CacheStore`                | Key-value cache with TTL             | (custom extension)                             |
| `CodeParser`                | JS/TS AST parsing and JSX annotation | `@veryfront/ext-parser-babel`                  |
| `ContentProcessor`          | MDX and Markdown compilation         | `@veryfront/ext-content-mdx`                   |
| `CSSProcessor`              | CSS compilation and utilities        | `@veryfront/ext-css-tailwind`                  |
| `DatabaseClient`            | SQL query/execute                    | (custom extension)                             |
| `DocumentExtractor`         | Document text extraction             | `@veryfront/ext-document-kreuzberg`            |
| `EmbeddingProvider`         | Vector embeddings                    | (custom extension)                             |
| `LLMProvider`               | Individual LLM provider              | `@veryfront/ext-llm-{anthropic,google,openai}` |
| `LLMProviderRegistry`       | LLM provider registry                | (built in)                                     |
| `ModuleLexer`               | ESM import/export analysis           | `@veryfront/ext-bundler-esbuild`               |
| `SandboxShellToolsProvider` | Sandbox shell tool creation          | `@veryfront/ext-sandbox-shell-tools`           |
| `SchemaValidator`           | Schema validation DSL                | `@veryfront/ext-schema-zod`                    |
| `SqliteStore`               | SQLite-backed persistence            | `@veryfront/ext-db-sqlite`                     |
| `TokenCacheStore`           | Proxy-grade cache with stats         | `@veryfront/ext-cache-redis`                   |
| `TracingExporter`           | OpenTelemetry span export            | `@veryfront/ext-tracing-opentelemetry`         |

Contract interfaces are importable from category entrypoints:

```ts
import type { CacheStore } from "veryfront/extensions/cache";
```

## Package metadata

For published extensions (npm/JSR), declare extension metadata in `deno.json` or `package.json`:

```json
{
  "name": "@myorg/ext-my-cache",
  "version": "1.0.0",
  "exports": "./src/index.ts",
  "veryfront": {
    "extension": true,
    "capabilities": [
      { "type": "contract", "name": "CacheStore" },
      { "type": "net:outbound", "hosts": ["*"] }
    ]
  }
}
```

The `veryfront.extension: true` flag enables auto-discovery. Installed packages with this metadata are loaded automatically without explicit config.

## Discovery and priority

Extensions are discovered from four sources, in priority order:

| Priority    | Source     | Location                                            |
| ----------- | ---------- | --------------------------------------------------- |
| 1 (highest) | Config     | `veryfront.config.ts` `extensions` array            |
| 2           | Package    | Installed packages with `veryfront.extension: true` |
| 3           | Project    | `extensions/<name>/src/index.ts` in your project    |
| 4 (lowest)  | Local file | `*.extension.ts` files in project root              |

When multiple extensions provide the same contract via static `provides`, the higher-priority source wins. Contracts registered dynamically via `ctx.provide()` in `setup()` are not subject to priority arbitration, so prefer static `provides` when possible. You can explicitly disable a discovered extension:

```ts
// veryfront.config.ts
export default {
  extensions: [
    { name: "ext-cache-redis", enabled: false },
    myCustomCache(),
  ],
};
```

## Presets

Bundle multiple extensions into a single installable unit:

```ts
import type { ExtensionFactory } from "veryfront/extensions";
import extEsbuild from "@veryfront/ext-bundler-esbuild";
import extTailwind from "@veryfront/ext-css-tailwind";
import extMdx from "@veryfront/ext-content-mdx";

const presetWeb: ExtensionFactory = (config?) => ({
  name: "preset-web",
  version: "1.0.0",
  capabilities: [],
  extends: [
    extEsbuild(),
    extTailwind(config?.tailwind),
    extMdx(),
  ],
});

export default presetWeb;
```

Presets are flattened before load. Their children are treated as independent extensions for the purposes of topological sort and conflict resolution.

## Configuration

Pass configuration to extensions through the config array or through project config:

### Via the extensions array

```ts
// veryfront.config.ts
import extRedis from "@veryfront/ext-cache-redis";

export default {
  extensions: [
    extRedis({ url: "redis://localhost:6379", prefix: "myapp:" }),
  ],
};
```

### Via project config (ctx.config)

Extensions can read from the project-wide config object in their `setup()`:

```ts
async setup(ctx) {
  const dbUrl = ctx.config.databaseUrl as string;
  // ...
}
```

## Testing extensions

Test your extension factory and its contract implementation:

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

describe("my-cache extension", () => {
  it("creates a valid extension", () => {
    const ext = factory({ maxSize: 100 });
    assertEquals(ext.name, "my-cache");
    assertEquals(ext.version, "1.0.0");
    assertEquals(Array.isArray(ext.capabilities), true);
  });

  it("provides CacheStore contract", async () => {
    const loader = new ExtensionLoader(noopLogger);
    await loader.setupAll(
      [{ extension: factory(), source: "config", origin: "test" }],
      {},
    );

    const cache = tryResolve<CacheStore>("CacheStore");
    assertExists(cache);

    await cache.set("key", "value", 60);
    assertEquals(await cache.get("key"), "value");

    await loader.teardownAll();
  });
});
```

Run tests:

```bash
deno test --no-check --allow-all extensions/my-cache/src/
```

## Example: building a CacheStore

Here's a complete in-memory cache extension implementing the `CacheStore` contract:

```ts
// extensions/memory-cache/src/index.ts
import type { ExtensionFactory } from "veryfront/extensions";
import type { CacheStore } from "veryfront/extensions/cache";

interface CacheEntry {
  value: unknown;
  expiresAt: number | null;
}

interface MemoryCacheConfig {
  maxSize?: number;
}

function createMemoryCache(config: MemoryCacheConfig): CacheStore {
  const store = new Map<string, CacheEntry>();
  const maxSize = config.maxSize ?? 1000;

  function evictExpired() {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt && entry.expiresAt <= now) {
        store.delete(key);
      }
    }
  }

  return {
    async get<T>(key: string): Promise<T | undefined> {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt && entry.expiresAt <= Date.now()) {
        store.delete(key);
        return undefined;
      }
      return entry.value as T;
    },

    async set<T>(key: string, value: T, ttl?: number): Promise<void> {
      if (store.size >= maxSize) evictExpired();
      store.set(key, {
        value,
        expiresAt: ttl ? Date.now() + ttl * 1000 : null,
      });
    },

    async delete(key: string): Promise<void> {
      store.delete(key);
    },

    async has(key: string): Promise<boolean> {
      const entry = store.get(key);
      if (!entry) return false;
      if (entry.expiresAt && entry.expiresAt <= Date.now()) {
        store.delete(key);
        return false;
      }
      return true;
    },

    async clear(): Promise<void> {
      store.clear();
    },

    async disconnect(): Promise<void> {
      store.clear();
    },
  };
}

const memoryCache: ExtensionFactory = (config?: unknown) => {
  const cfg = (config ?? {}) as MemoryCacheConfig;
  const cache = createMemoryCache(cfg);

  return {
    name: "memory-cache",
    version: "1.0.0",
    capabilities: [
      { type: "contract", name: "CacheStore" },
    ],
    provides: {
      CacheStore: cache,
    },
  };
};

export default memoryCache;
```

Register it in your config:

```ts
// veryfront.config.ts
import memoryCache from "./extensions/memory-cache/src/index.ts";

export default {
  extensions: [
    memoryCache({ maxSize: 500 }),
  ],
};
```

## Lifecycle

Extensions load in a deterministic order:

```
discover -> flatten presets -> topological sort -> setup() -> [runtime] -> teardown()
```

1. **Discovery** - Scans all four sources for extensions.
2. **Flatten** - Presets expand into their constituent extensions.
3. **Sort** - Providers load before consumers (Kahn's algorithm on the dependency graph).
4. **Setup** - Each extension's `setup()` runs in sorted order. If one throws, all previously-loaded extensions are torn down.
5. **Teardown** - On shutdown, `teardown()` runs in reverse load order.

### HMR behavior

During development, changes to `veryfront.config.ts` trigger a full teardown, re-discovery, and setup cycle. Extensions should release all resources in `teardown()` to support this.

## Error handling

The extension system provides clear errors with actionable suggestions:

| Error                           | When                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------ |
| `missing-extension`             | `resolve()` called for an unregistered contract. Includes recommended package. |
| `extension-validation`          | Extension shape is invalid, import fails, or factory throws.                   |
| `extension-circular-dependency` | Cyclic dependency detected in extends or contract graph.                       |
| `extension-conflict`            | Multiple extensions at the same priority provide the same contract.            |

When a required contract is missing, the error message suggests which package to install:

```
✖ Missing extension for contract "AuthProvider".
  Install it with: deno add @veryfront/ext-auth-jwt
```

## Publishing extensions

To publish an extension as a package:

1. Set `veryfront.extension: true` in your `deno.json`/`package.json`
2. List capabilities in the package metadata
3. Export your factory as the default export
4. Publish to npm or JSR

Users install your package and it's auto-discovered, no config changes needed:

```bash
deno add @myorg/ext-custom-cache
```

## Best practices

- **One contract per extension** - Keep extensions focused. Implement a single contract per package.
- **Declare all capabilities** - Be explicit about filesystem, network, and env var access.
- **Handle missing config gracefully** - Log a warning and skip registration instead of throwing when optional config is absent.
- **Clean up in teardown** - Close connections, cancel timers, flush buffers.
- **Use `ctx.logger`** - Structured logging integrates with the project's log pipeline.
- **Test with `ExtensionLoader`** - Integration-test the full lifecycle (setup, resolve, use, teardown).
- **Version your contracts** - When publishing, pin your contract interface version to avoid breakage.
