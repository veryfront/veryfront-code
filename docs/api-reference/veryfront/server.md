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

| Name                       | Description                                                                   | Source                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `HOSTED_ENVIRONMENT_NAMES` | Environment labels that `{slug}.{environment}.veryfront.com` actually routes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/utils/domain-parser.ts#L46) |
| `ReloadNotifier`           | Render reload notifier.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/reload-notifier.ts#L145)    |

### Functions

| Name                                 | Description                                                                                                                       | Source                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `createHandler`                      | Create a Veryfront request handler for development or production.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L240)               |
| `createVeryfrontServer`              | Create veryfront server.                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L156)      |
| `gracefullyShutdownProductionServer` | Enter lame-duck mode, mark readiness false, drain tracked requests and SSE response bodies, and stop a production server process. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/graceful-shutdown.ts#L217)   |
| `isHostedEnvironmentName`            | Whether `{slug}.{name}.veryfront.com` is a host the platform can route.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/utils/domain-parser.ts#L60)  |
| `parseProjectDomain`                 | Extract project slug and branch from domain/host header                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/utils/domain-parser.ts#L124) |
| `startDevServer`                     | Starts dev server.                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/index.ts#L19)     |
| `startNodeVeryfrontServer`           | Starts node veryfront server.                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L574)      |
| `startProductionServer`              | Starts production server.                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts#L181)   |
| `startServer`                        | Start a Veryfront server in development or production mode.                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L530)               |
| `startVeryfrontServer`               | Starts veryfront server.                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L554)      |
| `toNodeHandler`                      | Convert a Web API request handler into a Node.js HTTP listener.                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/node-handler.ts#L4)          |

### Classes

| Name             | Description           | Source                                                                                                       |
| ---------------- | --------------------- | ------------------------------------------------------------------------------------------------------------ |
| `DevServer`      | Implement dev server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/server.ts#L74)          |
| `RouteDiscovery` |                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/route-discovery.ts#L32) |

### Types

| Name                                   | Description                                                                                              | Source                                                                                                |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `BuildOptions`                         | Build System Type Definitions Consolidated from cli/commands/build/types.ts and server/build-types.ts    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/build-types.ts#L5)          |
| `BuildStats`                           | Public API contract for build stats.                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/build-types.ts#L27)         |
| `CreateVeryfrontServerOptions`         | Options accepted by create veryfront server.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L31)      |
| `DevServerHandler`                     | Public handler returned by a handler-only dev server.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts#L1)     |
| `DevServerOptions`                     | Options accepted by dev server.                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts#L4)     |
| `DiscoveryOptions`                     | Configuration for AI primitives discovery during server startup                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts#L119)  |
| `FileWatcherMetrics`                   | Public API contract for file watcher metrics.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts#L39)    |
| `GracefulProductionShutdownOptions`    | Inputs required to drain and stop a production server process.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/graceful-shutdown.ts#L24)   |
| `HostedEnvironmentName`                |                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/utils/domain-parser.ts#L48) |
| `NodeVeryfrontServiceServer`           | Public API contract for node veryfront service server.                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L82)      |
| `RouteDirectory`                       | Public API contract for route directory.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts#L33)    |
| `ServerHandle`                         | Public API contract for server handle.                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts#L156)  |
| `StartDevModeOptions`                  | Options accepted by start dev mode.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L119)              |
| `StartNodeVeryfrontServerOptions`      | Options accepted by start node veryfront server.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L46)      |
| `StartProductionModeOptions`           | Options accepted by start production mode.                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L128)              |
| `StartProductionServerOptions`         | Options accepted by start production server.                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts#L162)  |
| `StartServerOptions`                   | Server options. Defaults to development mode with HMR. Set `mode: "production"` for a production server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L144)              |
| `StartVeryfrontServerOptions`          | Options accepted by start veryfront server.                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L58)      |
| `VeryfrontHandler`                     | Web API request handler with WebSocket upgrade and HMR helpers.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L159)              |
| `VeryfrontServer`                      | Running server instance with lifecycle controls.                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L147)              |
| `VeryfrontServiceServer`               | Public API contract for veryfront service server.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L73)      |
| `VeryfrontServiceServerFetch`          | Public API contract for veryfront service server fetch.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L8)       |
| `VeryfrontServiceServerLogger`         | Public API contract for veryfront service server logger.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L23)      |
| `VeryfrontServiceServerModule`         | Public API contract for veryfront service server module.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L13)      |
| `VeryfrontServiceServerModuleResponse` | Response payload for veryfront service server module.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L10)      |
| `VeryfrontServiceServerRuntime`        | Public API contract for veryfront service server runtime.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L39)      |
| `VeryfrontServiceServerRuntimeKind`    | Public API contract for veryfront service server runtime kind.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L70)      |

### Constants

| Name                                  | Description                                                                                 | Source                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `defaultDistributedCacheInitializers` | Default wiring of distributed-cache initializers, assembled at the server composition root. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/distributed-cache-initializers.ts#L17) |
