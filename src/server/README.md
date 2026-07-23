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

While a production server is starting, health readiness remains false. Startup,
handler-readiness, or listener failures return readiness to false and run owned
cleanup before the failure is reported.

## External Node HTTP servers

`toNodeHandler()` converts the Web `Request`/`Response` handler into a Node HTTP
request listener. Development HMR additionally requires `upgrade()`:

```ts
import { createServer } from "node:http";
import { createHandler, toNodeHandler } from "veryfront/server";

const handler = await createHandler({ mode: "development", port: 3_000 });
const server = createServer(toNodeHandler(handler));

handler.upgrade(server);
server.once("close", () => void handler.dispose());
```

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

## Related documentation

- [Server runtime architecture](../../docs/architecture/04-server-runtime.md)
- [Runtime adapters](../../docs/architecture/15-runtime-adapters.md)
- [Configuration](../../docs/guides/configuration.md)
- [Build and deploy](../../docs/guides/deploying.md)
- [`veryfront/server` API reference](../../docs/api-reference/veryfront/server.md)
