# veryfront/platform

The platform package provides cross-runtime adapters and compatibility APIs for Deno, Node.js,
Bun, and Cloudflare Workers.

## Public API

Use `veryfront/platform` for runtime adapters, portable filesystem operations, process and
environment access, runtime detection, DNS resolution, MIME lookup, and key-value storage.
Use the dedicated subpaths for HTTP servers and path operations.

```ts
import {
  createFileSystem,
  detectRuntimeEnvironment,
  lookupMimeType,
  runtime,
} from "veryfront/platform";
import { createHttpServer } from "veryfront/platform/http";
import { join } from "veryfront/platform/path";

const adapter = await runtime.get();
const fs = createFileSystem();
const filename = join("content", "index.md");
const content = await fs.readTextFile(filename);

console.log({
  adapter: adapter.id,
  bytes: new TextEncoder().encode(content).byteLength,
  mimeType: lookupMimeType(filename),
  runtime: detectRuntimeEnvironment(),
});

const controller = new AbortController();
const server = createHttpServer();
const serving = server.serve(
  () => new Response("Veryfront"),
  {
    hostname: "127.0.0.1",
    port: 0,
    signal: controller.signal,
    onListen: () => controller.abort(),
  },
);

await serving;
await server.close();
```

Cloudflare Workers require an environment-specific adapter. Create it with
`createCloudflareAdapter`, then register it with `await runtime.set(adapter)` before code calls
`runtime.get`.

## Bounded process and server operations

`runCommand()` limits combined captured child stdout and stderr to 16 MiB by default. Set
`maxOutputBytes` when you need a smaller limit or a larger limit up to 64 MiB. If child output
exceeds the limit, Veryfront terminates the command and returns exit code `125` with
`outputLimitExceeded: true`.

The Node.js runtime adapter waits up to 30 seconds for graceful HTTP shutdown by default, then
force-closes active connections. Set `gracefulShutdownTimeoutMs` in `ServeOptions` to choose a
different bound. Veryfront rejects with a timeout error if HTTP or WebSocket resources still do
not settle.

## Runtime adapter contract

Every runtime adapter implements `RuntimeAdapter`. The stable contract includes:

- `id`, `name`, and immutable capability metadata
- `fs` for filesystem operations
- `env` for environment access
- `server` and `serve` for HTTP and WebSocket integration
- optional `kv`, `shell`, and `watcher` capabilities
- optional initialization and shutdown hooks

Use capability metadata before calling an optional runtime feature. Cloudflare Workers do not
provide a complete mutable filesystem, shell commands, or file watching.

## Filesystem adapters

The package includes adapters for local runtimes, Veryfront Cloud, GitHub, and in-memory tests.
Use `runtime.get().fs` for local filesystem access. `createFSAdapter` creates a configured
Veryfront Cloud, GitHub, or memory adapter. `VeryfrontFSAdapter` is public for applications that
need direct Veryfront Cloud filesystem access.

Use `createMockAdapter` in tests:

```ts
import { createMockAdapter } from "veryfront/platform";
import { assertEquals } from "veryfront/testing/assert";

Deno.test("stores a generated file", async () => {
  const adapter = createMockAdapter();
  await adapter.fs.writeFile("/generated/example.txt", "example");

  assertEquals(await adapter.fs.readFile("/generated/example.txt"), "example");
});
```

## Internal layout

```text
platform/
├── adapters/       Runtime, filesystem, token, and API-client adapters
├── cloud/          Veryfront Cloud bootstrap resolution
├── compat/         Portable process, filesystem, HTTP, path, DNS, crypto, and KV APIs
├── polyfills/      Browser-safe modules used by the import rewriter
├── core-platform.ts
├── environment.ts
└── index.ts
```

The platform layer is infrastructure. Domain logic belongs in its owning module. Public consumers
must import through `veryfront/platform` or one of its documented subpaths instead of importing
source files directly.

## Related documentation

- [Platform adapters](./adapters/README.md)
- [GitHub filesystem adapter](./adapters/fs/github/README.md)
