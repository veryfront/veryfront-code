# Server module reference

The server module exposes the framework's development and production HTTP
lifecycles, embeddable request handlers, and the lower-level composable service
server.

```ts
import {
  createHandler,
  createVeryfrontServer,
  startDevServer,
  startProductionServer,
  startServer,
  toNodeHandler,
} from "veryfront/server";
```

## Framework server APIs

| API                              | Return value                | Purpose                                                                                                                           |
| -------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `startServer(options?)`          | `Promise<VeryfrontServer>`  | Start development mode by default, or production when `mode: "production"` is set. Defaults the project directory and port.       |
| `startDevServer(options)`        | `Promise<DevServer>`        | Bootstrap and start the development server, including configured file watching and HMR. The returned instance is already started. |
| `startProductionServer(options)` | `Promise<ServerHandle>`     | Bootstrap and start the production server. `ready` resolves only after both the HTTP listener and request handler are ready.      |
| `createHandler(options?)`        | `Promise<VeryfrontHandler>` | Create a development or production request handler for an externally managed HTTP server.                                         |

`startServer` accepts `StartServerOptions`. Its returned `VeryfrontServer`
contains `ready`, `stop()`, `port`, and `url`.

`startDevServer` requires `DevServerOptions`, including `projectDir` and `port`.
Use `handlerOnly: true` when another HTTP server owns the listener.

`startProductionServer` requires `StartProductionServerOptions`, including
`projectDir` and `port`. An optional `bootstrapResult` transfers exclusive
ownership of that bootstrap result to the returned server handle.

`createHandler` accepts:

```ts
type CreateHandlerOptions = {
  projectDir?: string;
  mode?: "development" | "production";
  port?: number;
};
```

The selected mode is an immutable runtime profile. Production constructs its
registry without development/control handlers: HMR, development files and UI,
debug context and dashboards, metrics and memory-debug routes, client-log
ingestion, local-project browsing, and Markdown preview are not registered.
`localProjects` and other local-source metadata select where application source
comes from; they never switch a production handler into the development
profile. A request to one of those paths therefore follows the normal
production not-found path even when its project source is local.

When the development memory-debug handler is enabled for a local project,
forced garbage collection is an operator action at `POST /_debug/memory/gc`.
It requires configured Basic or Bearer authentication, returns `401` when no
operator credentials are configured, shares concurrent calls, and admits at
most one new operation per 60 seconds. Other methods return `405` with
`Allow: POST`.

The returned handler is callable and also exposes:

```ts
type VeryfrontHandler = {
  (request: Request): Promise<Response>;
  upgrade(server: unknown): void;
  connectHMR(socket: WebSocket): void;
  dispose(): Promise<void>;
};
```

`upgrade()` attaches development HMR upgrade handling to a Node HTTP server.
`connectHMR()` registers a WebSocket upgraded by an external runtime.

## Lifecycle and ownership

Bootstrap-backed server APIs own process-wide extension-registry, telemetry,
SSR, and HMR state. Only one such generation may be live in a process. Starting
a second generation before stopping or disposing the first rejects instead of
silently replacing its globals.

The caller must retain and close the returned lifecycle object:

- call `stop()` on `VeryfrontServer`, `DevServer`, or `ServerHandle`;
- call `dispose()` on `VeryfrontHandler` after the external HTTP server stops;
- do not separately dispose a `BootstrapResult` passed to
  `startProductionServer`.

Concurrent shutdown calls share the same in-flight cleanup. Successful cleanup
is idempotent. If cleanup rejects, ownership remains held and a later shutdown
call retries the unfinished phases; a replacement server remains blocked until
that retry succeeds.

Process-level graceful shutdown drains tracked requests and then attempts every
allowed cleanup phase within one deadline. A successful call returns whether
the drain completed before its timeout. Any required cleanup failure or timeout
rejects with an `AggregateError` after telemetry shutdown is attempted; its
`errors` preserve cleanup execution order. Bootstrap disposal is skipped when
the HTTP listener may still be live. Direct execution keeps a rejected attempt
retryable, and the CLI exits nonzero rather than reporting incomplete cleanup as
success.

While a production server is starting, health readiness remains false. Startup,
handler-readiness, or listener failures return readiness to false and run owned
cleanup before the failure is reported.

When HMR is enabled, development startup also waits for the configured watch
roots and the runtime watcher's `ready` barrier. Missing watch roots, filesystem
inspection failures, and watcher acquisition failures reject startup instead of
starting without functional HMR. If an acquired watcher later terminates, the
development server stops that generation rather than continuing to serve stale
routes and modules. Route rediscovery builds an isolated candidate and publishes
it only after every directory read succeeds, so a transient discovery failure
retains the previous route generation and does not trigger a browser reload.

## External Node HTTP servers

`toNodeHandler()` converts the Web `Request`/`Response` handler into a Node HTTP
request listener. Development HMR additionally requires `upgrade()`:

```ts
import { createServer } from "node:http";
import { createHandler, toNodeHandler } from "veryfront/server";

const handler = await createHandler({ mode: "development", port: 3_000 });
const server = createServer(toNodeHandler(handler));

handler.upgrade(server);

async function shutdown(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  await handler.dispose();
}

process.once("SIGTERM", () => {
  void shutdown().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
});
```

The compatibility listener delegates to the canonical Platform Node bridge.
Client disconnects abort the Fetch `Request.signal`; streamed responses wait for
Node backpressure to drain; a stream failure before headers returns `500`, while
a failure after headers destroys the response instead of attempting a second
header write.

The external server remains responsible for calling `server.close()`. Handler
disposal removes the attached upgrade listener, terminates owned HMR sockets,
closes the no-server WebSocket server, and releases bootstrap resources.

## Composable service server

`createVeryfrontServer(options)` creates an ordered module dispatcher. Each
module may return a response or decline the request with `null`/`undefined`.
The returned runtime exposes `fetch`, `setShuttingDown`, and `stop`.

`startVeryfrontServer(options)` starts that runtime on the detected Node, Deno,
or Bun host. `startNodeVeryfrontServer(options)` is the Node-specific form. Both
return a service handle with `ready`, `stop()`, `port`, `url`, and `runtime`;
the Node-specific handle also exposes its HTTP `server`.

Await `ready` before using the service handle. If a Node listener cannot bind,
the server automatically removes its signal listeners and stops the supplied
runtime before `ready` rejects. The original listener error is preserved when
cleanup succeeds. If cleanup is incomplete, the rejection exposes
`retryCleanup`; calling it or `stop()` retries only the unfinished cleanup
phases. Calling `stop()` before the Node listener binds also rejects `ready`
instead of leaving readiness pending.

Node service startup uses the same Platform listener owner as adapter-backed
servers. This owner also retires a native Node 18 listener that finishes a
queued hostname lookup and binds after an earlier stop.

## CSS request boundary

The development stylesheet route reads `styles.stylesheet`, or the
conventional `globals.css` when no path is configured. If no project
stylesheet is available, it uses the registered `CSSProcessor` extension's
`defaultStylesheet`. Server captures the provider-neutral compilation and
optimization identities before cache or artifact resolution; it does not
import a vendor CSS engine or switch to one after an asynchronous failure.

Compilation failures return a non-success `application/problem+json` response.
Prepared and remote artifacts are accepted only when their content, style
profile, source selector, and exact CSS pipeline identity agree with the
request.

## Generated framework CSS candidates

Framework component class-name candidates are collected recursively from the
tracked React UI, chat, and primitive source roots. Test/spec files are excluded
and the result is sorted and deduplicated before it reaches the registered
`CSSProcessor`. Run
`deno task generate:framework-candidates:check` to compare current source with
the tracked generated array without writing files; this check is also part of
`generate:manifests:check`. Regeneration remains part of the build-generation
workflow. A missing optional source root is tolerated, while permission and I/O
failures are reported rather than treated as an empty candidate set.

## Related documentation

- [Server runtime architecture](../../docs/architecture/04-server-runtime.md)
- [Runtime adapters](../../docs/architecture/15-runtime-adapters.md)
- [Configuration](../../docs/guides/configuration.md)
- [Build and deploy](../../docs/guides/deploying.md)
- [`veryfront/server` API reference](../../docs/api-reference/veryfront/server.md)
