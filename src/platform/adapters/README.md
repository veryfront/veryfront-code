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
import { createFSAdapter, type FSAdapter } from "#veryfront/platform/adapters/index.ts";

// Local filesystem
const fsAdapter: FSAdapter = await createFSAdapter({
  type: "local",
  projectDir: "/path/to/project",
});

// Remote Veryfront API
const remoteFS: FSAdapter = await createFSAdapter({
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

## Compatibility Layer

Use `veryfront/platform` for cross-runtime compatibility utilities:

```ts
import { openKv, readTextFile, writeTextFile } from "veryfront/platform";

// KV store (Deno.Kv compatible API)
const kv = await openKv("./data.db");
await kv.set(["users", "alice"], { name: "Alice" });
const entry = await kv.get(["users", "alice"]);

// Filesystem utilities
const content = await readTextFile("./file.txt");
await writeTextFile("./output.txt", "Hello");
```

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
      retryDelay?: number;
    };
  };
}
```

### Veryfront API Configuration

```ts
interface VeryfrontAPIConfig {
  apiBaseUrl: string;
  apiToken?: string;
  projectSlug?: string;
  projectId?: string;
  proxyMode?: boolean;
  retry?: {
    maxRetries?: number; // Default: 3
    initialDelay?: number; // Default: 1000ms
    maxDelay?: number; // Default: 10000ms
  };
}
```

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
2. **Initialize adapters** - Always call `initialize()` after creating an adapter
3. **Handle missing features** - Check for optional methods before using them
4. **Cache remote FS calls** - Enable caching for Veryfront API to reduce latency
5. **Use FSAdapter interface** - Abstract filesystem access for portability

## Testing with Adapters

```ts
import { createFSAdapter } from "#veryfront/platform/adapters/index.ts";

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

- [Veryfront Documentation](https://veryfront.com/docs/framework)
