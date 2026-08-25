---
title: "veryfront/server"
description: "Create and run Veryfront servers."
order: 35
---

## Import

```ts
import {
  createHandler,
  createVeryfrontServer,
  gracefullyShutdownProductionServer,
  initializeProductionErrorReportingFromEnv,
  isHostedEnvironmentName,
  parseProjectDomain,
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

| Name                       | Description                                                                   | Source                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `HOSTED_ENVIRONMENT_NAMES` | Environment labels that `{slug}.{environment}.veryfront.com` actually routes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/utils/domain-parser.ts#L47) |
| `ReloadNotifier`           | Render reload notifier.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/reload-notifier.ts#L146)    |

### Functions

| Name                                        | Description                                                                                                                       | Source                                                                                                       |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `createHandler`                             | Create a Veryfront request handler for development or production.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L242)                     |
| `createVeryfrontServer`                     | Create veryfront server.                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L157)            |
| `gracefullyShutdownProductionServer`        | Enter lame-duck mode, mark readiness false, drain tracked requests and SSE response bodies, and stop a production server process. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/graceful-shutdown.ts#L218)         |
| `initializeProductionErrorReportingFromEnv` | Initialize env-configured production error reporting for the server process.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-error-reporting.ts#L13) |
| `isHostedEnvironmentName`                   | Whether `{slug}.{name}.veryfront.com` is a host the platform can route.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/utils/domain-parser.ts#L61)        |
| `parseProjectDomain`                        | Extract project slug and branch from domain/host header                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/utils/domain-parser.ts#L125)       |
| `startDevServer`                            | Starts dev server.                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/index.ts#L20)           |
| `startNodeVeryfrontServer`                  | Starts node veryfront server.                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L575)            |
| `startProductionServer`                     | Starts production server.                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts#L182)         |
| `startServer`                               | Start a Veryfront server in development or production mode.                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L532)                     |
| `startVeryfrontServer`                      | Starts veryfront server.                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L555)            |
| `toNodeHandler`                             | Convert a Web API request handler into a Node.js HTTP listener.                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/node-handler.ts#L5)                |

### Classes

| Name             | Description           | Source                                                                                                       |
| ---------------- | --------------------- | ------------------------------------------------------------------------------------------------------------ |
| `DevServer`      | Implement dev server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/server.ts#L75)          |
| `RouteDiscovery` |                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/route-discovery.ts#L33) |

### Types

| Name                                   | Description                                                                                              | Source                                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `BuildOptions`                         | Build System Type Definitions Consolidated from cli/commands/build/types.ts and server/build-types.ts    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/build-types.ts#L6)          |
| `BuildStats`                           | Public API contract for build stats.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/build-types.ts#L28)         |
| `CreateVeryfrontServerOptions`         | Options accepted by create veryfront server.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L32)      |
| `DevServerHandler`                     | Public handler returned by a handler-only dev server.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts#L2)     |
| `DevServerOptions`                     | Options accepted by dev server.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts#L5)     |
| `DiscoveryOptions`                     | Configuration for AI primitives discovery during server startup                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts#L120)  |
| `FileWatcherMetrics`                   | Public API contract for file watcher metrics.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts#L40)    |
| `GracefulProductionShutdownOptions`    | Inputs required to drain and stop a production server process.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/graceful-shutdown.ts#L25)   |
| `HostedEnvironmentName`                |                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/utils/domain-parser.ts#L49) |
| `NodeVeryfrontServiceServer`           | Public API contract for node veryfront service server.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L83)      |
| `RouteDirectory`                       | Public API contract for route directory.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts#L34)    |
| `ServerHandle`                         | Public API contract for server handle.                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts#L157)  |
| `StartDevModeOptions`                  | Options accepted by start dev mode.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L121)              |
| `StartNodeVeryfrontServerOptions`      | Options accepted by start node veryfront server.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L47)      |
| `StartProductionModeOptions`           | Options accepted by start production mode.                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L130)              |
| `StartProductionServerOptions`         | Options accepted by start production server.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts#L163)  |
| `StartServerOptions`                   | Server options. Defaults to development mode with HMR. Set `mode: "production"` for a production server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L146)              |
| `StartVeryfrontServerOptions`          | Options accepted by start veryfront server.                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L59)      |
| `VeryfrontHandler`                     | Web API request handler with WebSocket upgrade and HMR helpers.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L161)              |
| `VeryfrontServer`                      | Running server instance with lifecycle controls.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L149)              |
| `VeryfrontServiceServer`               | Public API contract for veryfront service server.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L74)      |
| `VeryfrontServiceServerFetch`          | Public API contract for veryfront service server fetch.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L9)       |
| `VeryfrontServiceServerLogger`         | Public API contract for veryfront service server logger.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L24)      |
| `VeryfrontServiceServerModule`         | Public API contract for veryfront service server module.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L14)      |
| `VeryfrontServiceServerModuleResponse` | Response payload for veryfront service server module.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L11)      |
| `VeryfrontServiceServerRuntime`        | Public API contract for veryfront service server runtime.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L40)      |
| `VeryfrontServiceServerRuntimeKind`    | Public API contract for veryfront service server runtime kind.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L71)      |

### Constants

| Name                                  | Description                                                                                 | Source                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `defaultDistributedCacheInitializers` | Default wiring of distributed-cache initializers, assembled at the server composition root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/distributed-cache-initializers.ts#L18) |
