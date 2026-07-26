# #veryfront/platform

> Cross-platform adapters for Deno, Node.js, Bun, and Cloudflare Workers

## What It Does

Provides unified abstractions for platform-specific APIs:

- **Filesystem Operations**: Read, write, watch files across platforms
- **HTTP Servers**: Create HTTP servers with platform-specific implementations
- **Runtime Detection**: Automatic platform detection
- **File Caching**: In-memory file caching layer
- **Path Compatibility**: Cross-platform path handling
- **Virtual Filesystems**: GitHub and Veryfront API adapters

## When to Use

**Use when:**

- Reading/writing files in a platform-agnostic way
- Creating HTTP servers
- Detecting runtime environment
- Caching file contents
- Normalizing file paths
- Accessing remote filesystems (GitHub, Veryfront API)

**Don't use for:**

- Business logic (use `#veryfront/runtime`)
- Route handling (use `#veryfront/routing`)

## Quick Start

```typescript
// Automatic platform detection
import { runtime } from "veryfront/platform";

const adapter = await runtime.get();
console.log(adapter.id); // 'deno' | 'node' | 'bun' | 'cloudflare' | 'memory'

// Filesystem operations
const content = await adapter.fs.readFile("/path/to/file.txt");
await adapter.fs.writeFile("/path/to/output.txt", "Hello World");

const exists = await adapter.fs.exists("/path/to/check.txt");
const stats = await adapter.fs.stat("/path/to/file.txt");

// HTTP server
import { createHttpServer } from "veryfront/platform/http";

const server = createHttpServer();
await server.serve(async (req) => {
  return new Response("Hello!");
}, {
  port: 3000,
});

// File watching
if (adapter.watcher) {
  const watcher = adapter.watcher.watch("/src");
  for await (const event of watcher) {
    console.log(`Files changed: ${event.paths.join(", ")}`);
  }
}

// File cache
import { createFileCache } from "#veryfront/platform/adapters/fs/cache/index.ts";

const fileCache = createFileCache({
  ttl: 5000, // 5 seconds
});
await fileCache.setAsync("/src/index.ts", content);

// Durable KV storage
import { createKVStore } from "veryfront/platform";

// An explicit path requires native Deno KV or the SQLite extension. The call
// rejects instead of silently substituting process-local memory.
const kv = await createKVStore({ path: "./data.db" });
await kv.set(["users", "alice"], { name: "Alice" });

// Omit the path only when volatile, process-local storage is intentional.
const volatileKv = await createKVStore();
```

## Structure

```
platform/
├── adapters/
│   ├── base.ts                # Base adapter interfaces
│   ├── detect.ts              # Auto-detection
│   ├── registry.ts            # Adapter registry
│   ├── mock.ts                # Mock adapter for testing
│   ├── fallback-wrapper.ts    # Fallback wrapper utilities
│   ├── fs/                    # Filesystem adapters
│   │   ├── cache/             # In-memory caching layer
│   │   ├── github/            # GitHub API filesystem
│   │   └── veryfront/         # Veryfront API filesystem
│   ├── runtime/               # Runtime-specific implementations
│   │   ├── deno/              # Deno adapter
│   │   ├── node/              # Node.js adapter
│   │   ├── bun/               # Bun adapter
│   │   ├── cloudflare/        # Cloudflare Workers adapter
│   │   └── shared/            # Shared utilities
│   ├── security/              # Security wrappers (sandbox)
│   ├── token/                 # Token management
│   │   └── veryfront/         # Veryfront OAuth tokens
│   └── veryfront-api-client/  # Veryfront Cloud API client
├── compat/                    # Compatibility layers
│   ├── console/               # Console output compatibility
│   ├── http/                  # HTTP server abstraction
│   ├── kv/                    # Key-value store (memory/SQLite)
│   ├── path/                  # Path operations
│   ├── crypto.ts              # Crypto polyfills
│   ├── fs.ts                  # Filesystem polyfills
│   ├── runtime.ts             # Runtime detection utilities
│   ├── process.ts             # Process polyfills
│   ├── flags.ts               # Feature flags
│   └── media-types.ts         # MIME type detection
└── index.ts
```

## Dependencies

**Depends on:**

- `#veryfront/types` - Shared types
- `#veryfront/utils` - Utilities

**Depended on by:**

- `#veryfront/runtime` - Uses filesystem adapters
- `#veryfront/transforms` - Uses filesystem for compilation
- All server-side code

**Layer:** INFRASTRUCTURE (Adapters)

## Key Concepts

### Adapter Pattern

Each runtime has its own adapter implementing `RuntimeAdapter`:

```typescript
interface RuntimeAdapter {
  runtime: "deno" | "node" | "bun" | "cloudflare";
  fs: FileSystemAdapter;
  http: HttpAdapter;
  process: ProcessAdapter;
}
```

### Platform Detection

```typescript
import { runtime } from "#veryfront/platform/adapters/registry.ts";

const adapter = await runtime.get();
// Uses feature detection, not user agent
// adapter.id is "deno" | "node" | "bun" | "cloudflare"
```

### Virtual Filesystems

Access remote files as if they were local:

```typescript
// Veryfront API filesystem
import { VeryfrontFSAdapter } from "#veryfront/platform/adapters/fs/veryfront";

const vfAdapter = new VeryfrontFSAdapter(client);
const content = await vfAdapter.readFile("pages/index.mdx");

// GitHub filesystem
import { GitHubFSAdapter } from "#veryfront/platform/adapters/fs/github";

const ghAdapter = new GitHubFSAdapter({ owner, repo, token });
const content = await ghAdapter.readFile("README.md");
```

### File Caching Strategy

- LRU cache with configurable size
- TTL-based expiration
- Automatic invalidation on write
- Memory-efficient for large projects

## Platform-Specific Features

### Deno

```typescript
import { DenoAdapter } from "#veryfront/platform/adapters/runtime/deno";

const adapter = new DenoAdapter();
// Native Deno.* APIs
// Permission-aware
// KV store support
```

### Node.js

```typescript
import { NodeAdapter } from "#veryfront/platform/adapters/runtime/node";

const adapter = await NodeAdapter.create();
// Uses fs, path, http modules
// Process management
// Native module support
```

### Bun

```typescript
import { BunAdapter } from "#veryfront/platform/adapters/runtime/bun";

const adapter = new BunAdapter();
// Ultra-fast file operations
// Native transpilation
// Web API compatibility
```

### Cloudflare Workers

Cloudflare Workers receive requests through an exported `fetch` handler; they
cannot open a listener. Construct the adapter with the bindings from the current
request and export a worker handler:

```typescript
import {
  type CloudflareKVNamespace,
  createCloudflareAdapter,
  createWorker,
} from "#veryfront/platform";
import { MiddlewarePipeline } from "#veryfront/middleware";

export default createWorker((env) => {
  const files = env.FILES as CloudflareKVNamespace | undefined;
  const adapter = createCloudflareAdapter(env, files);

  return new MiddlewarePipeline().use(() => {
    return Response.json({
      runtime: adapter.id,
      writableFilesystem: adapter.capabilities.writableFs,
    });
  });
});
```

`CloudflareAdapter.serve()` rejects because there is no listener to open. Pass a
KV namespace explicitly to enable the KV-backed virtual filesystem. KV has no
native directory primitive, so the adapter stores reserved trailing-slash keys
for empty directories. Empty-directory and file removal are supported;
recursive removal of non-empty directories fails closed because KV has no
atomic multi-key delete. WebSocket upgrades accept custom response headers and
an offered subprotocol. Cloudflare has no transport-level idle-timeout option,
so use application heartbeats; `idleTimeout: 0` is accepted as the portable
“no timeout” sentinel.

The invariant Worker memory limit is 128 MiB. CPU limits depend on the
deployment plan and configuration, so Veryfront does not invent a CPU budget or
derive an agent-step cap from the runtime profile. See Cloudflare's
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[KV limits](https://developers.cloudflare.com/kv/platform/limits/), and
[WebSocket API](https://developers.cloudflare.com/workers/runtime-apis/websockets/).

## Testing

```typescript
import { assertEquals } from "veryfront/testing/assert";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";

Deno.test("Filesystem operations", async () => {
  const adapter = createMockAdapter();

  await adapter.fs.writeFile("/tmp/test.txt", "Hello");
  const content = await adapter.fs.readFile("/tmp/test.txt");

  assertEquals(content, "Hello");
});
```

## See Also

- [Platform Adapters](./adapters/README.md) - Filesystem and runtime adapters
- [GitHub Filesystem](./adapters/fs/github/README.md) - GitHub API filesystem

## License

Part of Veryfront framework
