# @veryfront/platform

> Cross-platform adapters for Deno, Node.js, Bun, and Cloudflare Workers

## What It Does

Provides unified abstractions for platform-specific APIs:

- **Filesystem Operations**: Read, write, watch files across platforms
- **HTTP Servers**: Create HTTP servers with platform-specific implementations
- **Runtime Detection**: Automatic platform detection
- **File Caching**: In-memory file caching layer
- **Path Compatibility**: Cross-platform path handling

## When to Use

**Use when:**

- Reading/writing files in a platform-agnostic way
- Creating HTTP servers
- Detecting runtime environment
- Caching file contents
- Normalizing file paths

**Don't use for:**

- Business logic (use `@veryfront/runtime`)
- Route handling (use `@veryfront/routing`)

## Quick Start

```typescript
// Automatic platform detection
import { getAdapter } from "@veryfront/platform/adapters/detect";

const adapter = await getAdapter();
console.log(adapter.runtime); // 'deno' | 'node' | 'bun' | 'cloudflare'

// Filesystem operations
const content = await adapter.fs.readTextFile("/path/to/file.txt");
await adapter.fs.writeTextFile("/path/to/output.txt", "Hello World");

const exists = await adapter.fs.exists("/path/to/check.txt");
const stats = await adapter.fs.stat("/path/to/file.txt");

// HTTP Server
import { DenoHttpServer } from "@veryfront/platform/adapters/deno";

const server = new DenoHttpServer();
await server.listen(3000, async (req) => {
  return new Response("Hello from Deno!");
});

// File watching
adapter.fs.watch("/src", (event, path) => {
  console.log(`File ${event}: ${path}`);
});

// Cached filesystem (faster reads)
import { createFileCacheAdapter } from "@veryfront/platform";

const cachedFs = createFileCacheAdapter(adapter.fs, {
  maxSize: 100 * 1024 * 1024, // 100MB cache
  ttl: 5000, // 5 second TTL
});

const content = await cachedFs.readTextFile("config.json"); // Cached
```

## Structure

```
platform/
├── adapters/
│   ├── base.ts              # Base adapter interfaces
│   ├── detect.ts            # Auto-detection
│   ├── deno.ts              # Deno implementation
│   ├── node/                # Node.js implementation
│   ├── bun/                 # Bun implementation
│   ├── file-cache/          # Caching layer
│   └── veryfront-api-client/ # Veryfront Cloud API
├── compat/                   # Compatibility layers
│   ├── path/                # Path normalization
│   ├── crypto.ts            # Crypto polyfills
│   └── runtime.ts           # Runtime utilities
└── security/                 # Security wrappers
    └── sandbox.ts
```

## 🔗 Dependencies

**Depends on:**

- `@veryfront/types` - Shared types
- `@veryfront/utils` - Utilities

**Depended on by:**

- `@veryfront/runtime` - Uses filesystem adapters
- `@veryfront/transforms` - Uses filesystem for compilation
- All server-side code

**Layer:** 🟡 INFRASTRUCTURE (Adapters)

## 📚 Key Concepts

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
import { detectRuntime } from "@veryfront/platform";

const runtime = detectRuntime();
// Uses feature detection, not user agent
```

### File Caching Strategy

- LRU cache with configurable size
- TTL-based expiration
- Automatic invalidation on write
- Memory-efficient for large projects

## 🔧 Platform-Specific Features

### Deno

```typescript
import { DenoAdapter } from "@veryfront/platform/adapters/deno";

const adapter = new DenoAdapter();
// Native Deno.* APIs
// Permission-aware
// KV store support
```

### Node.js

```typescript
import { NodeAdapter } from "@veryfront/platform/adapters/node";

const adapter = await NodeAdapter.create();
// Uses fs, path, http modules
// Process management
// Native module support
```

### Bun

```typescript
import { BunAdapter } from "@veryfront/platform/adapters/bun";

const adapter = new BunAdapter();
// Ultra-fast file operations
// Native transpilation
// Web API compatibility
```

## 🧪 Testing

```typescript
import { assertEquals } from "std/assert/mod.ts";
import { getAdapter } from "@veryfront/platform";

Deno.test("Filesystem operations", async () => {
  const adapter = await getAdapter();

  await adapter.fs.writeTextFile("/tmp/test.txt", "Hello");
  const content = await adapter.fs.readTextFile("/tmp/test.txt");

  assertEquals(content, "Hello");
});
```

## 🔗 See Also

- [@veryfront/runtime](../runtime/README.md) - Runtime engine
- [Platform Adapters Guide](../../docs/platform-adapters.md)
- [File Caching Guide](../../docs/file-caching.md)

## 📄 License

Part of Veryfront framework
