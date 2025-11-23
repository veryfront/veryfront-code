# Adapters Module

The Adapters module provides runtime abstraction layer for cross-platform compatibility across Deno, Node.js, Bun, and Cloudflare Workers.

## Import Map Alias

```typescript
// Using import map alias (recommended)
import { BunAdapter, DenoAdapter, getAdapter, NodeAdapter, RuntimeAdapter } from "#adapters";

// Using barrel file
import { getAdapter, RuntimeAdapter } from "./adapters/index.ts";
```

## Public API Overview

The Adapters module exports:

- **`RuntimeAdapter`** - Base adapter interface for runtime abstraction
- **`getAdapter()`** - Auto-detects and returns current runtime adapter
- **Runtime-Specific Adapters** - BunAdapter, DenoAdapter, NodeAdapter
- **Filesystem Abstraction** - FSAdapter, VeryfrontFSAdapter, FSAdapterWrapper
- **API Client** - VeryfrontAPIClient for remote filesystem access
- **Utility Namespaces** - compat, react, security adapters

## File Structure

```
adapters/
├── index.ts                    # Public API (barrel file) ← USE THIS
├── README.md                   # This file
├── base.ts                     # RuntimeAdapter base interface
├── deno.ts                     # Deno runtime adapter
├── node.ts                     # Node.js runtime adapter
├── bun.ts                      # Bun runtime adapter
├── detect.ts                   # Runtime detection
├── compat/                     # Runtime compatibility utilities
│   ├── index.ts
│   ├── kv/                     # KV store compatibility layer
│   └── fs.ts                   # Filesystem compatibility
├── react/                      # React-specific adapters
│   ├── index.ts
│   └── ssr-adapter/            # SSR rendering adapters
├── security/                   # Security adapters
│   └── index.ts
├── veryfront-api-client.ts     # API client for remote FS
├── veryfront-fs-adapter.ts     # Remote FS adapter
├── fs-adapter-wrapper.ts       # FS adapter wrapper utilities
└── fs-integration.ts           # FS adapter integration helpers
```

## Quick Start

### Auto-Detect Runtime

```ts
import { getAdapter } from "#adapters";

const adapter = await getAdapter();

// Check which runtime
console.log(adapter.name); // 'deno' | 'node' | 'bun' | 'cloudflare-workers'

// Use adapter APIs
const config = await adapter.readTextFile("./config.json");
```

### Runtime-Specific Adapters

```ts
import { BunAdapter, DenoAdapter, NodeAdapter } from "#adapters";

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
import { createFSAdapter, type FSAdapter } from "#adapters";

// Local filesystem
const fsAdapter: FSAdapter = await createFSAdapter({
  type: "local",
  projectDir: "/path/to/project",
});

// Remote Veryfront API
const remoteFS: FSAdapter = await createFSAdapter({
  type: "veryfront-api",
  veryfront: {
    apiKey: process.env.VERYFRONT_API_KEY,
    projectSlug: "my-project",
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
  name: "deno" | "node" | "bun" | "cloudflare-workers";

  // Lifecycle
  initialize(): Promise<void>;

  // Filesystem
  fs: {
    readFile(path: string): Promise<Uint8Array>;
    readTextFile(path: string): Promise<string>;
    writeFile(path: string, data: Uint8Array | string): Promise<void>;
    exists(path: string): Promise<boolean>;
    stat(path: string): Promise<FileInfo>;
    readDir(path: string): AsyncIterableIterator<DirEntry>;
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  };

  // Environment
  env: {
    get(key: string): string | undefined;
    set(key: string, value: string): void;
  };

  // Process
  exit(code?: number): never;
  cwd(): string;

  // File watching (optional)
  watch?(paths: string[]): AsyncIterableIterator<FileChangeEvent>;
}
```

## Compatibility Layer

The compat namespace provides cross-runtime utilities:

```ts
import { compat } from "#adapters";

// KV store (Deno.Kv compatible API)
const kv = await compat.openKv("./data.db");
await kv.set(["users", "alice"], { name: "Alice" });
const entry = await kv.get(["users", "alice"]);

// Filesystem utilities
const content = await compat.fs.readText("./file.txt");
await compat.fs.writeText("./output.txt", "Hello");
```

## React Adapters

React-specific adapters for server-side rendering:

```ts
import { react } from "#adapters";

// Get SSR adapter for current runtime
const ssrAdapter = await react.getSSRAdapter();

// Render to stream (React 18+)
const stream = await ssrAdapter.renderToReadableStream(<App />);

// Render to string (React 17)
const html = await ssrAdapter.renderToString(<App />);
```

## Security Adapters

Security utilities for secure operations:

```ts
import { security } from "#adapters";

// Hash generation
const hash = await security.generateHash("data", "sha256");

// Secure random
const randomBytes = security.randomBytes(32);

// JWT operations (if available)
const token = await security.signJWT({ userId: "123" }, "secret");
const payload = await security.verifyJWT(token, "secret");
```

## Remote Filesystem (Veryfront API)

Access project files via Veryfront API:

```ts
import { VeryfrontAPIClient, VeryfrontFSAdapter } from "#adapters";

// Direct API client
const client = new VeryfrontAPIClient({
  apiKey: process.env.VERYFRONT_API_KEY,
  projectSlug: "my-project",
});

// List files
const files = await client.listFiles("/src");

// Get file content
const content = await client.getFile("/src/index.ts");

// Or use as FSAdapter
const fsAdapter = new VeryfrontFSAdapter({
  type: "veryfront-api",
  veryfront: {
    apiKey: process.env.VERYFRONT_API_KEY,
    projectSlug: "my-project",
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
  type?: "local" | "veryfront-api" | "memory";
  projectDir?: string;
  veryfront?: {
    apiKey?: string;
    apiToken?: string;
    projectSlug?: string;
    baseUrl?: string;
    cache?: {
      enabled?: boolean;
      ttl?: number;
    };
    retry?: {
      maxRetries?: number;
      retryDelay?: number;
    };
  };
}
```

### Veryfront API Configuration

```ts
interface VeryfrontAPIConfig {
  apiKey: string;
  projectSlug: string;
  baseUrl?: string; // Default: 'https://api.veryfront.com'
  cache?: {
    enabled?: boolean;
    ttl?: number; // Cache TTL in milliseconds
  };
  retry?: {
    maxRetries?: number; // Default: 3
    retryDelay?: number; // Default: 1000ms
  };
}
```

## Runtime Detection

```ts
import { getAdapter } from "#adapters";

const adapter = await getAdapter();

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
import { NotSupportedError, VeryfrontAPIError } from "#adapters";

try {
  const adapter = await getAdapter();
  await adapter.fs.readFile("/config.json");
} catch (error) {
  if (error instanceof VeryfrontAPIError) {
    // API-specific error
    console.error("API error:", error.statusCode, error.message);
  } else if (error instanceof NotSupportedError) {
    // Feature not supported in current runtime
    console.error("Not supported:", error.message);
  }
}
```

## Best Practices

1. **Use getAdapter() for auto-detection** - Let the runtime be detected automatically
2. **Initialize adapters** - Always call `initialize()` after creating an adapter
3. **Handle missing features** - Check for optional methods before using them
4. **Cache remote FS calls** - Enable caching for Veryfront API to reduce latency
5. **Use FSAdapter interface** - Abstract filesystem access for portability

## Testing with Adapters

```ts
import { createFSAdapter } from "#adapters";

// Use memory adapter for tests
const testFS = await createFSAdapter({
  type: "memory",
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
- Choose the right adapter: local > Bun > Deno > Node for performance

## Related Modules

- **#config** - Configuration loading using adapters
- **#server** - Server implementations for each runtime
- **#build** - Build system with runtime-specific optimizations
- **#rendering** - SSR with React adapters

## References

- [Runtime Compatibility Guide](../../docs/runtime-compatibility.md)
- [Deployment Guide](../../docs/deployment.md)
- [Veryfront API Documentation](https://docs.veryfront.com/api)
