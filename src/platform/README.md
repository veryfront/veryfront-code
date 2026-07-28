# veryfront/platform

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
// Automatic detection is available for local Deno, Node.js, and Bun hosts.
import { runtime } from "veryfront/platform";

const adapter = await runtime.get();
console.log(adapter.id); // "deno" | "node" | "bun"

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

// File watching is available only when the runtime advertises it.
if (adapter.capabilities.fileWatching) {
  const watcher = adapter.fs.watch("/src");
  await watcher.ready;
  for await (const event of watcher) {
    console.log(`Files changed: ${event.paths.join(", ")}`);
    if (event.paths.some((path) => path.endsWith("veryfront.config.ts"))) break;
  }
  await watcher.done;
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

Cloudflare Workers are request-driven and require request-scoped bindings.
Automatic registry initialization therefore rejects in Workers. Construct a
Cloudflare adapter explicitly as shown in
[Cloudflare Workers](#cloudflare-workers).

Use `HttpServer`'s `onListen` callback as the portable readiness boundary and
`close()` as its awaitable shutdown barrier. Startup rejects before binding
when its signal is already aborted; ephemeral listeners report their actual
native port.

Local adapters can own more than one server. Each returned `Server.stop()`
retires only that listener; `adapter.shutdown()` retires every server still
owned by the adapter. Concurrent shutdown calls share one attempt, and a
failed stop remains tracked so a later shutdown can retry it.

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
│   ├── process/               # Commands, environment, and lifecycle
│   ├── shims/                 # Narrow compatibility entrypoints
│   ├── std/                   # Bounded std-compatible helpers
│   ├── crypto.ts              # Crypto polyfills
│   ├── fs.ts                  # Filesystem polyfills
│   ├── runtime.ts             # Runtime detection utilities
│   ├── process.ts             # Public process compatibility barrel
│   └── media-types.ts         # MIME type detection
├── polyfills/                 # Browser-safe Node builtin placeholders
└── index.ts
```

## Dependencies

**Key shared dependencies:**

- `#veryfront/errors` - Structured boundary failures
- `#veryfront/observability` - Adapter and compatibility spans
- `#veryfront/utils` - Logging and bounded configuration helpers
- `#veryfront/cache`, `#veryfront/registry`, and `#veryfront/release-assets` -
  Hosted filesystem cache and source-snapshot coordination
- `#veryfront/schemas` - API response validation
- Runtime-native APIs and Web platform primitives

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
  readonly id: "deno" | "node" | "bun" | "cloudflare" | "memory";
  readonly name: string;
  readonly capabilities: RuntimeCapabilities;
  readonly fs: FileSystemAdapter;
  readonly env: EnvironmentAdapter;
  readonly server: ServerAdapter;
  readonly shell?: ShellAdapter;
  readonly kv?: KVStoreAdapter;
  readonly watcher?: FileWatcherAdapter;

  serve(
    handler: (request: Request) => Promise<Response> | Response,
    options: ServeOptions,
  ): Promise<Server>;
  initialize?(): Promise<void>;
  shutdown?(): Promise<void>;
}
```

### Platform Detection

```typescript
import { runtime } from "#veryfront/platform/adapters/registry.ts";

const adapter = await runtime.get();
// Uses host feature detection, not the user agent.
// Automatic construction supports "deno", "node", and "bun".
// Cloudflare requires createCloudflareAdapter(env).
```

### Virtual Filesystems

Access remote files as if they were local:

```typescript
import { createFSAdapter } from "#veryfront/platform/adapters/fs/index.ts";

// Veryfront API filesystem
const vfAdapter = await createFSAdapter({
  type: "veryfront-api",
  veryfront: {
    apiBaseUrl: "https://api.veryfront.com",
    apiToken: "<API_TOKEN>",
    projectSlug: "<PROJECT_SLUG>",
  },
});
const vfContent = await vfAdapter.readFile("pages/index.mdx");

// GitHub filesystem
const ghAdapter = await createFSAdapter({
  type: "github",
  github: {
    owner: "<OWNER>",
    repo: "<REPOSITORY>",
    token: "<GITHUB_TOKEN>",
  },
});
const githubContent = await ghAdapter.readFile("README.md");
```

Local filesystem access comes from `RuntimeAdapter.fs`; passing `type: "local"`
to `createFSAdapter()` is an error. The legacy `"memory"` filesystem
configuration is also unsupported and fails explicitly. Tests that need
process-local files should use `createMockAdapter()`.

### File Caching Strategy

- Bounded entry and memory limits for instance-local caches
- TTL-based expiration with validated, stable serialization
- In-flight request deduplication scoped to the full operation identity
- Hosted cache keys scoped by project and source snapshot
- GitHub cache keys scoped by repository and ref

## Platform-Specific Features

### Deno

```typescript
import { DenoAdapter } from "#veryfront/platform/adapters/runtime/deno";

const adapter = new DenoAdapter();
// Native Deno.* APIs
// Permission-aware
// KV store support
```

Deno server startup rejects an already-aborted signal before opening a
listener and reports the actual native address when `port: 0` is used. Returned
servers own their shutdown signal, so direct stop and adapter-wide shutdown
close active work without mutating a caller-owned controller. WebSocket
upgrades select only an explicitly offered subprotocol and accept Deno's
non-negative finite per-connection idle timeout. Deno cannot attach custom
headers to its native status-101 response, so those options fail explicitly.
Filesystem watching uses `Deno.watchFs`; `ready` and `done` delimit native
installation and teardown, and event paths retain the caller-visible root.

### Node.js

```typescript
import { NodeAdapter } from "#veryfront/platform/adapters/runtime/node/index.ts";

const adapter = new NodeAdapter();
// Uses fs, path, http modules
// Process management
// Native module support
```

Node WebSocket upgrades validate the RFC 6455 request and apply only the
application-selected client subprotocol. Custom response headers are preserved;
transport-owned handshake headers and unsupported nonzero per-connection idle
timeouts are rejected. Text frames remain strings and binary frames remain
`ArrayBuffer` values. Server shutdown force-closes active HTTP and WebSocket
transports and aborts their request signals.

### Bun

```typescript
import { BunAdapter } from "#veryfront/platform/adapters/runtime/bun/index.ts";

const adapter = new BunAdapter();
// Bun-native file-content fast paths plus documented node:fs operations
// Bun.serve HTTP and WebSocket lifecycle integration
// Native TypeScript, JSX, workers, and HTTP/2 runtime capabilities
```

Bun can complete `server.upgrade()` synchronously. Code that sends an initial
message must send immediately when `socket.readyState === WebSocket.OPEN` and
otherwise register a one-shot `open` listener. Bun configures WebSocket idle
timeouts per server, so the portable adapter accepts `idleTimeout: 0` and
rejects unsupported nonzero per-connection values.

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

The environment adapter snapshots the binding object's own string values when
it is constructed. Inherited properties and non-string resources are not
exposed as environment variables. Calls to `env.set()` write to an
adapter-local overlay and never mutate the deployment binding object.

The invariant Worker memory limit is 128 MiB. CPU limits depend on the
deployment plan and configuration, so Veryfront does not invent a CPU budget or
derive an agent-step cap from the runtime profile. See Cloudflare's
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[KV limits](https://developers.cloudflare.com/kv/platform/limits/), and
[WebSocket API](https://developers.cloudflare.com/workers/runtime-apis/websockets/).

## Compatibility contracts

### Filesystem failures and temporary directories

Portable and local-runtime `exists()` implementations return `false` only for a
recognized missing path. Invalid paths, permission failures, and other
operational errors are propagated. Temporary-directory prefixes are filename
fragments, not paths: `/`, `\`, and null bytes are rejected before a prefix is
combined with the operating-system temp root.

`FileSystemAdapter.readFileBytesBounded(path, byteLimit)` is an optional,
additive capability. Node, Deno, and Bun read through native handles in bounded
chunks and return either EOF or exactly the requested prefix. Hosted wrappers
expose the method only when their underlying adapter implements the same
contract. The Veryfront API, GitHub, and Cloudflare KV adapters intentionally
omit it because their current upstream APIs return whole objects; advertising a
post-read slice as a bounded read would be misleading. Consumers must retain a
compatible, post-validated path for third-party adapters that omit the method.

`FileSystemAdapter.readFileBytes(path)` and
`FileSystemAdapter.writeFileBytes(path, content)` are the binary-safe whole-file
capabilities. Node, Deno, Bun, Cloudflare KV, and the in-memory adapter preserve
bytes without a text round trip. Hosted wrappers delegate each capability only
when the underlying adapter implements it; consumers that require binary
output must fail before writing when `writeFileBytes` is absent.

### Commands

`runCommand()` passes `args` separately unless `shell: true` is explicitly
requested. `clearEnv: true` starts the child with an empty environment before
applying the provided values. Captured stdout and stderr share a bounded byte
budget, which defaults to 16 MiB. `timeoutMs` is disabled when omitted or set to
`0`; any other value must be a positive safe integer no greater than
`2147483647`. A timeout returns exit code 124, caller cancellation returns exit
code 130, and exceeding the capture budget terminates the child and returns
exit code 125 with `outputTruncated: true`.

Termination targets the runtime-owned POSIX process group or a Windows
`taskkill /T` tree and escalates after a bounded grace period. Capture streams
are then closed so detached descendants that retain inherited pipes cannot
delay the result indefinitely. This cleanup is best effort: hostile detached
descendants can escape operating-system process-group or tree discovery.

```typescript
import { runCommand } from "veryfront/platform";

const result = await runCommand("git", {
  args: ["status", "--short"],
  capture: true,
  maxOutputBytes: 1024 * 1024,
  timeoutMs: 30_000,
});

if (!result.success) {
  throw new Error(result.stderr ?? `git exited with ${result.code}`);
}
```

### Maintainer compatibility helpers

- `compat/std/dotenv.ts` parses bounded input into a null-prototype record and
  rejects malformed assignments, unsafe keys, interpolation cycles, and
  oversized expansion. A missing file produces an empty result; other I/O
  failures propagate. Exporting values rolls back partial changes if a later
  write fails.
- `compat/std/flags.ts` provides one argument parser for Deno, Node.js, and Bun.
  It applies aliases, defaults, collection, negation, dotted keys, and unknown
  argument policy consistently while blocking prototype-bearing keys.
- `compat/std/fs.ts` provides the supported `@std/fs` subset. Traversal is
  bounded by the caller's depth, symlink cycles are tracked, regex filters do
  not leak mutable `lastIndex` state, and invalid option combinations reject.
- `compat/path/` recognizes Windows and POSIX syntax independently of the host
  operating system. File URL conversion stays in the dedicated URL helpers.
- Runtime detection gives specific Bun and Cloudflare host signals precedence
  over overlapping Node compatibility globals. Unknown runtimes and
  request-scoped Cloudflare initialization fail explicitly.
- Global error callbacks suppress the runtime default only by returning
  `true`. Arbitrary thrown values are normalized without invoking object
  conversion hooks, and a failing callback is reported without recursively
  swallowing the original fatal event.

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
