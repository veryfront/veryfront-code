# Adapters Module

The Adapters module provides runtime abstraction layer for cross-platform compatibility across Deno, Node.js, Bun, and Cloudflare Workers.

## Imports

```typescript
// Public runtime adapter API
import { runtime, type RuntimeAdapter } from "veryfront/platform";

// Concrete adapter classes for adapter-maintainer code
import { BunAdapter, DenoAdapter, NodeAdapter } from "#veryfront/platform/adapters/index.ts";
```

## Public API Overview

The Adapters module exports:

- **`RuntimeAdapter`** - Base adapter interface for runtime abstraction
- **`runtime.get()`** - Auto-detects and returns the singleton runtime adapter
- **Runtime-Specific Adapters** - BunAdapter, DenoAdapter, NodeAdapter
- **Filesystem Abstraction** - FSAdapter, VeryfrontFSAdapter, FSAdapterWrapper
- **API Client** - VeryfrontApiClient for remote filesystem access
- **Security Adapter Helpers** - Permission and sandbox utilities

## File Structure

```
adapters/
|-- index.ts                    # Adapter barrel for internal imports
|-- base.ts                     # RuntimeAdapter base interface
|-- detect.ts                   # Runtime detection compatibility helper
|-- registry.ts                 # Singleton runtime adapter registry
|-- runtime-detection.ts        # Runtime detection primitives
|-- bun.ts                      # Bun runtime adapter
|-- deno.ts                     # Deno runtime adapter
|-- node.ts                     # Node.js runtime adapter
|-- runtime/                    # Runtime-specific HTTP/WebSocket adapters
|-- fs/                         # Filesystem adapters and wrappers
|-- security/                   # Permission and sandbox helpers
|-- token/                      # Token storage adapters
`-- veryfront-api-client/       # API client for remote filesystem access
```

## Quick Start

### Auto-Detect Runtime

```ts
import { runtime } from "veryfront/platform";

const adapter = await runtime.get();

// Check which runtime
console.log(adapter.name); // 'deno' | 'node' | 'bun' | 'cloudflare-workers'

// Use adapter APIs
const config = await adapter.fs.readFile("./config.json");
```

### Runtime-Specific Adapters

```ts
import { BunAdapter, DenoAdapter, NodeAdapter } from "#veryfront/platform/adapters/index.ts";

// Deno
const denoAdapter = new DenoAdapter();
await denoAdapter.initialize();

// Node.js
const nodeAdapter = new NodeAdapter();
await nodeAdapter.initialize();

// Bun
const bunAdapter = new BunAdapter();
await bunAdapter.initialize();
```

### Filesystem Abstraction

```ts
import { createFSAdapter, runtime } from "veryfront/platform";

// Local filesystem
const localFS = (await runtime.get()).fs;

// Remote Veryfront API
const remoteFS = await createFSAdapter({
  type: "veryfront-api",
  veryfront: {
    apiToken: "<API_TOKEN>",
    projectSlug: "<PROJECT_SLUG>",
  },
});

// Read files
const content = await remoteFS.readFile("/src/index.ts");
const exists = await remoteFS.exists("/config.json");

// Directory operations
for await (const entry of remoteFS.readDir("/src")) {
  console.log(entry.name, entry.isDirectory);
}
```

## RuntimeAdapter Interface

All runtime adapters implement the `RuntimeAdapter` interface:

```ts
interface RuntimeAdapter {
  id: "deno" | "node" | "bun" | "cloudflare" | "memory";
  name: string;
  capabilities: RuntimeCapabilities;

  // Lifecycle
  initialize?(): Promise<void>;
  shutdown?(): Promise<void>;

  // Filesystem
  fs: {
    readFile(path: string): Promise<string>;
    writeFile(path: string, data: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    stat(path: string): Promise<FileInfo>;
    readDir(path: string): AsyncIterable<DirEntry>;
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  };

  // Environment
  env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
  };

  // Server
  serve(
    handler: (request: Request) => Response | Promise<Response>,
    options: ServeOptions,
  ): Promise<Server>;

  // File watching (optional)
  watcher?: FileWatcherAdapter;
}
```

## Compatibility layer

Use `veryfront/platform` for cross-runtime compatibility utilities:

```ts
import { createKVStore, readTextFile, writeTextFile } from "veryfront/platform";

// Persistent KV store with string-array keys and JSON-compatible values.
// Veryfront throws if no durable backend can open this path.
const kv = await createKVStore({
  path: "./data.db",
  backend: "sqlite",
  fallback: "error",
});
try {
  await kv.set(["users", "alice"], { name: "Alice" });
  const entry = await kv.get(["users", "alice"]);
  console.log(entry.value);
} finally {
  kv.close();
}

// Filesystem utilities
const content = await readTextFile("./file.txt");
await writeTextFile("./output.txt", "Hello");
```

### KV portability contract

Veryfront KV provides one portable contract across native Deno KV, SQLite, and memory adapters:

- Keys are non-empty arrays of well-formed strings.
- Values are plain, lossless JSON values. Do not store `Date`, `Map`, `undefined`, sparse arrays, accessors, cycles, non-finite numbers, or negative zero.
- `list({ prefix })` returns strict descendants. It does not return the prefix key itself.
- `start` is inclusive and `end` is exclusive.
- List operations inspect at most 1,000 backend entries by default. Use a narrow selector or set
  `maxScanEntries` up to 10,000 when a larger bounded scan is required. Veryfront throws instead
  of returning a silently truncated result when the scan bound is exceeded.
- `close()` is idempotent. Operations after close fail.

Use the exported limits when validating data before a write:

```ts
import { createKVStore, KV_PORTABLE_LIMITS, type KvJsonValue } from "veryfront/platform";

const value: KvJsonValue = { status: "ready", attempts: 1 };
const valueBytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
if (valueBytes > KV_PORTABLE_LIMITS.maxValueBytes) {
  throw new Error("The KV value is too large");
}

const kv = await createKVStore({ path: ":memory:" });
try {
  await kv.set(["runs", "example"], value);
} finally {
  kv.close();
}
```

Runtime validation is authoritative. TypeScript's `number` type cannot exclude `NaN`, infinities, or negative zero. The generic types on `get()` and `list()` describe the shape you expect, but they do not validate application-specific fields. Validate untrusted values with an application schema before use.

Use `path: ":memory:"` only for explicitly ephemeral data. For durable data, pass a path and `fallback: "error"`. Legacy pathless calls without an explicit fallback policy can use memory when no persistent backend is available. These forms are deprecated for new code.

Durable paths are backend-specific. Pin `backend` to `"native"` or `"sqlite"` when data must survive runtime or feature-flag changes. The default `"auto"` mode prefers native KV and then SQLite, so the same path can refer to different storage formats on different runtimes.

The native adapter stores new values as versioned canonical JSON payloads so the same portable size limit applies to every backend. It continues to read legacy raw JSON values.

`polyfillDenoKv()` from `veryfront/platform` is deprecated. Existing applications can use it to install this portable subset when `Deno.openKv` is unavailable. New applications must use `createKVStore()`. The polyfill does not replace native Deno KV or add transactions, atomic operations, queues, or watches.

## Security Adapters

Security utilities for secure operations:

```ts
import { requestPermission, runInWorker } from "#veryfront/platform/adapters/security/index.ts";

const permission = await requestPermission({ name: "read", path: "./src" });
if (permission.state !== "granted") {
  throw new Error("Read permission is required");
}

const result = await runInWorker("return 'hello'.toUpperCase();");
```

## Remote Filesystem (Veryfront API)

Access project files via Veryfront API:

```ts
import { VeryfrontApiClient, VeryfrontFSAdapter } from "#veryfront/platform/adapters/index.ts";

// Direct API client
const client = new VeryfrontApiClient({
  apiBaseUrl: "https://api.veryfront.com",
  apiToken: "<API_TOKEN>",
  projectSlug: "<PROJECT_SLUG>",
});

// List files
const files = await client.listFiles({ pattern: "src/**" });

// Get file content
const content = await client.getFileContent("/src/index.ts");

// Or use as FSAdapter
const fsAdapter = new VeryfrontFSAdapter({
  type: "veryfront-api",
  veryfront: {
    apiToken: "<API_TOKEN>",
    projectSlug: "<PROJECT_SLUG>",
    cache: {
      enabled: true,
      ttl: 300000, // 5 minutes
    },
  },
});

await fsAdapter.initialize();
const file = await fsAdapter.readTextFile("/config.json");
```

## Configuration

### FSAdapter Configuration

```ts
interface FSAdapterConfig {
  type?: "local" | "veryfront-api" | "memory" | "github";
  projectDir?: string;
  memory?: {
    files?: Readonly<Record<string, string | Uint8Array>>;
  };
  veryfront?: {
    apiToken?: string;
    projectSlug?: string;
    projectId?: string;
    apiBaseUrl?: string;
    proxyMode?: boolean;
    cache?: {
      enabled?: boolean;
      ttl?: number;
    };
    retry?: {
      maxRetries?: number;
      initialDelay?: number;
      maxDelay?: number;
      retryDelay?: number; // Deprecated alias for initialDelay
    };
  };
  github?: {
    token: string;
    owner: string;
    repo: string;
    ref?: string;
    cache?: {
      enabled?: boolean;
      ttl?: number;
      maxSize?: number;
      maxMemory?: number;
    };
    retry?: {
      maxRetries?: number;
      initialDelay?: number;
      maxDelay?: number;
      requestTimeout?: number;
      totalTimeout?: number;
      maxResponseBytes?: number;
    };
  };
}
```

### Veryfront API configuration

```ts
interface VeryfrontAPIConfig {
  apiBaseUrl: string;
  apiToken?: string;
  requestTokenProvider?: () => string | undefined; // Deprecated
  requestIdentityProvider?: () =>
    | {
      readonly token: string;
      readonly projectSlug: string;
      readonly fileContext?:
        | { readonly type: "branch"; readonly name: string }
        | { readonly type: "environment"; readonly name: string }
        | { readonly type: "release"; readonly version: string };
    }
    | undefined;
  projectSlug?: string;
  projectId?: string;
  proxyMode?: boolean;
  requestPolicy?: {
    signal?: AbortSignal;
    timeoutMs?: number; // Per attempt. Default: 30000ms
    totalTimeoutMs?: number; // Complete logical operation. Default: 120000ms
    maxResponseBytes?: number; // Per response. Default: 64 MiB, maximum: 256 MiB
  };
  retry?: {
    maxRetries?: number; // Default: 3
    initialDelay?: number; // Default: 1000ms
    maxDelay?: number; // Default: 10000ms
  };
}
```

Concurrent proxy clients must use `requestIdentityProvider`. The provider returns the token,
project slug, and optional file context together, and the client captures that identity once for
the complete logical operation. `requestTokenProvider` remains available for compatible
single-project callers, but it cannot atomically pair changing authorization and routing values.

Pass a request policy as the final argument to override the configured defaults for one
high-level operation. The client snapshots configured defaults and per-call overrides before
starting the operation.

```ts
import { VeryfrontApiClient } from "veryfront/platform";

const client = new VeryfrontApiClient({
  apiBaseUrl: "https://api.example.com",
  apiToken: "<TOKEN>",
  projectSlug: "<PROJECT_SLUG>",
});
const controller = new AbortController();

const files = await client.listAllFiles(
  { limit: 100, maxPages: 50, maxFiles: 5_000 },
  {
    signal: controller.signal,
    timeoutMs: 10_000,
    totalTimeoutMs: 60_000,
    maxResponseBytes: 8 * 1024 * 1024,
  },
);
```

`totalTimeoutMs` covers retries and every page in a paginated operation. The client does not
restart that budget for each page. `maxResponseBytes` applies to each response body and accepts
integer limits from 1 byte through 256 MiB.

Release asset uploads accept at most 10 MiB per asset, verify the SHA-256 hash, and upload an
immutable byte snapshot. Oversized assets fail before the client copies, hashes, or sends the
body. Applications can enforce a smaller limit before calling the client.

### API client compatibility notes

- Retry counts must be integers from 0 through 20.
- Explicit empty API tokens, request tokens, project slugs, and request identity values fail
  before a request. The client does not fall back to broader credentials for these values.
- File search and list-all methods follow pagination until completion and enforce page and file
  budgets.
- Public configuration, policy, list, context, style artifact, and asset manifest inputs are
  snapshotted and runtime-validated. Invalid values now fail with a sanitized `VeryfrontError`
  before network work starts.
- String selectors remain permissive after type validation. The Veryfront API remains the
  authority for supported project, branch, environment, release, path, pattern, style, and
  manifest values.

## Runtime Detection

```ts
import { runtime } from "veryfront/platform";

const adapter = await runtime.get();

// Detect specific runtime
if (adapter.name === "deno") {
  // Deno-specific code
} else if (adapter.name === "node") {
  // Node-specific code
} else if (adapter.name === "bun") {
  // Bun-specific code
}

// Or check capabilities
if (adapter.watch) {
  // Runtime supports file watching
  for await (const event of adapter.watch(["./src"])) {
    console.log("File changed:", event.path);
  }
}
```

## Error Handling

```ts
import {
  API_CLIENT_ERROR,
  NotSupportedError,
  VeryfrontError,
} from "#veryfront/platform/adapters/index.ts";
import { runtime } from "veryfront/platform";

try {
  const adapter = await runtime.get();
  await adapter.fs.readFile("/config.json");
} catch (error) {
  if (error instanceof VeryfrontError && error.slug === API_CLIENT_ERROR.slug) {
    // API-specific error
    console.error("API error:", error.status, error.message);
  } else if (error instanceof NotSupportedError) {
    // Feature not supported in current runtime
    console.error("Not supported:", error.message);
  }
}
```

## Best Practices

1. **Use `runtime.get()` for auto-detection** - Let the runtime be detected automatically and reused
2. **Initialize direct adapter instances** - Call `initialize()` when you construct an adapter class directly. `createFSAdapter()` initializes adapters before returning them.
3. **Handle missing features** - Check for optional methods before using them
4. **Cache remote FS calls** - Enable caching for Veryfront API to reduce latency
5. **Use FSAdapter interface** - Abstract filesystem access for portability

## Testing with Adapters

```ts
import { createFSAdapter } from "veryfront/platform";

// Use an explicitly ephemeral memory adapter for tests
const testFS = await createFSAdapter({
  type: "memory",
  memory: {
    files: {
      "/fixtures/config.json": '{"enabled":true}',
    },
  },
});

// Mock filesystem operations
await testFS.writeFile("/test.txt", "test content");
const exists = await testFS.exists("/test.txt"); // true
```

## Performance Tips

- Use file watching (`adapter.watch()`) instead of polling
- Enable caching for remote filesystem operations
- Batch filesystem reads when possible
- Use async iterators for directory traversal (memory efficient)
- Use the runtime filesystem for durable local sources. Use the memory adapter only for explicitly ephemeral data.

## Related Modules

- **#config** - Configuration loading using adapters
- **#server** - Server implementations for each runtime
- **#build** - Build system with runtime-specific optimizations
- **#rendering** - SSR with React adapters

## References

- [Veryfront Documentation](https://veryfront.com/docs/framework)
