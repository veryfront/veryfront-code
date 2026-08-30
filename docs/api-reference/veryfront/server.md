---
title: "veryfront/server"
description: "Create and run Veryfront servers."
order: 36
---

## Import

```ts
import {
  createHandler,
  createVeryfrontServer,
  gracefullyShutdownProductionServer,
  isHostedEnvironmentName,
  parseProjectDomain,
  startDevServer,
} from "veryfront/server";
```

## Examples

### Composable service server

```ts
import { createVeryfrontServer } from "veryfront/server";

const server = createVeryfrontServer({
  modules: [{
    name: "agent",
    handle: (request) => new Response(`Handled ${request.url}`),
  }],
});

await server.fetch(new Request("https://example.com/health"));
```

## Exports

### Components

| Name                       | Description                                                                   | Source                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `HOSTED_ENVIRONMENT_NAMES` | Environment labels that `{slug}.{environment}.veryfront.com` actually routes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/utils/domain-parser.ts) |
| `ReloadNotifier`           | Render reload notifier.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/reload-notifier.ts)     |

### Functions

| Name                                 | Description                                                                                                                       | Source                                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `createHandler`                      | Create a Veryfront request handler for development or production.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts)               |
| `createVeryfrontServer`              | Create veryfront server.                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)      |
| `gracefullyShutdownProductionServer` | Enter lame-duck mode, mark readiness false, drain tracked requests and SSE response bodies, and stop a production server process. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/graceful-shutdown.ts)   |
| `isHostedEnvironmentName`            | Whether `{slug}.{name}.veryfront.com` is a host the platform can route.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/utils/domain-parser.ts) |
| `parseProjectDomain`                 | Extract project slug and branch from domain/host header                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/utils/domain-parser.ts) |
| `startDevServer`                     | Starts dev server.                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/index.ts)    |
| `startNodeVeryfrontServer`           | Starts node veryfront server.                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)      |
| `startProductionServer`              | Starts production server.                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts)   |
| `startServer`                        | Start a Veryfront server in development or production mode.                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts)               |
| `startVeryfrontServer`               | Starts veryfront server.                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)      |
| `toNodeHandler`                      | Convert a Web API request handler into a Node.js HTTP listener.                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/node-handler.ts)        |

### Classes

| Name             | Description           | Source                                                                                                   |
| ---------------- | --------------------- | -------------------------------------------------------------------------------------------------------- |
| `DevServer`      | Implement dev server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/server.ts)          |
| `RouteDiscovery` |                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/route-discovery.ts) |

### Types

| Name                                   | Description                                                                                              | Source                                                                                            |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `BuildOptions`                         | Build System Type Definitions Consolidated from cli/commands/build/types.ts and server/build-types.ts    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/build-types.ts)         |
| `BuildStats`                           | Public API contract for build stats.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/build-types.ts)         |
| `CreateVeryfrontServerOptions`         | Options accepted by create veryfront server.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)      |
| `DevServerHandler`                     | Public handler returned by a handler-only dev server.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts)    |
| `DevServerOptions`                     | Options accepted by dev server.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts)    |
| `DiscoveryOptions`                     | Configuration for AI primitives discovery during server startup                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts)   |
| `FileWatcherMetrics`                   | Public API contract for file watcher metrics.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts)    |
| `GracefulProductionShutdownOptions`    | Inputs required to drain and stop a production server process.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/graceful-shutdown.ts)   |
| `HostedEnvironmentName`                |                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/utils/domain-parser.ts) |
| `NodeVeryfrontServiceServer`           | Public API contract for node veryfront service server.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)      |
| `RouteDirectory`                       | Public API contract for route directory.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts)    |
| `ServerHandle`                         | Public API contract for server handle.                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts)   |
| `StartDevModeOptions`                  | Options accepted by start dev mode.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts)               |
| `StartNodeVeryfrontServerOptions`      | Options accepted by start node veryfront server.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)      |
| `StartProductionModeOptions`           | Options accepted by start production mode.                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts)               |
| `StartProductionServerOptions`         | Options accepted by start production server.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts)   |
| `StartServerOptions`                   | Server options. Defaults to development mode with HMR. Set `mode: "production"` for a production server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts)               |
| `StartVeryfrontServerOptions`          | Options accepted by start veryfront server.                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)      |
| `VeryfrontHandler`                     | Web API request handler with WebSocket upgrade and HMR helpers.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts)               |
| `VeryfrontServer`                      | Running server instance with lifecycle controls.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts)               |
| `VeryfrontServiceServer`               | Public API contract for veryfront service server.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)      |
| `VeryfrontServiceServerFetch`          | Public API contract for veryfront service server fetch.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)      |
| `VeryfrontServiceServerLogger`         | Public API contract for veryfront service server logger.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)      |
| `VeryfrontServiceServerModule`         | Public API contract for veryfront service server module.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)      |
| `VeryfrontServiceServerModuleResponse` | Response payload for veryfront service server module.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)      |
| `VeryfrontServiceServerRuntime`        | Public API contract for veryfront service server runtime.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)      |
| `VeryfrontServiceServerRuntimeKind`    | Public API contract for veryfront service server runtime kind.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts)      |

### Constants

| Name                                  | Description                                                                                 | Source                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `defaultDistributedCacheInitializers` | Default wiring of distributed-cache initializers, assembled at the server composition root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/distributed-cache-initializers.ts) |
