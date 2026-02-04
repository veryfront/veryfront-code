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
import { getAdapter } from "#veryfront/platform/adapters/detect";

const adapter = await getAdapter();
console.log(adapter.runtime); // 'deno' | 'node' | 'bun' | 'cloudflare'

// Filesystem operations
const content = await adapter.fs.readTextFile("/path/to/file.txt");
await adapter.fs.writeTextFile("/path/to/output.txt", "Hello World");

const exists = await adapter.fs.exists("/path/to/check.txt");
const stats = await adapter.fs.stat("/path/to/file.txt");

// HTTP Server
import { createHttpServer } from "#veryfront/platform/compat/http";

const server = createHttpServer();
await server.listen(3000, async (req) => {
  return new Response("Hello!");
});

// File watching
adapter.fs.watch("/src", (event, path) => {
  console.log(`File ${event}: ${path}`);
});

// Cached filesystem (faster reads)
import { createFileCacheAdapter } from "#veryfront/platform/adapters/fs/cache";

const cachedFs = createFileCacheAdapter(adapter.fs, {
  maxSize: 100 * 1024 * 1024, // 100MB cache
  ttl: 5000, // 5 second TTL
});
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
import { detectRuntime } from "#veryfront/platform/compat/runtime";

const runtime = detectRuntime();
// Uses feature detection, not user agent
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

## Testing

```typescript
import { assertEquals } from "std/assert/mod.ts";
import { MockAdapter } from "#veryfront/platform/adapters/mock";

Deno.test("Filesystem operations", async () => {
  const adapter = new MockAdapter();

  await adapter.fs.writeTextFile("/tmp/test.txt", "Hello");
  const content = await adapter.fs.readTextFile("/tmp/test.txt");

  assertEquals(content, "Hello");
});
```

## See Also

- [Platform Adapters](./adapters/README.md) - Filesystem and runtime adapters
- [GitHub Filesystem](./adapters/fs/github/README.md) - GitHub API filesystem

## License

Part of Veryfront framework
