---
title: "veryfront/server"
description: "Server runtime APIs. Creates and runs a Veryfront server in tests, custom runtimes, and production adapters."
order: 29
---

Server runtime APIs. Creates and runs a Veryfront server in tests, custom runtimes, and production adapters.

## Import

```ts
import {
  createHandler,
  createVeryfrontServer,
  startDevServer,
  startNodeVeryfrontServer,
  startProductionServer,
  startServer,
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

| Name | Description | Source |
|------|-------------|--------|
| `ReloadNotifier` | Render reload notifier. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/reload-notifier.ts#L159) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createHandler` | Create a Veryfront request handler for development or production. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L194) |
| `createVeryfrontServer` | Create veryfront server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L149) |
| `startDevServer` | Starts dev server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/index.ts#L15) |
| `startNodeVeryfrontServer` | Starts node veryfront server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L559) |
| `startProductionServer` | Starts production server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts#L167) |
| `startServer` | Start a Veryfront server in development or production mode. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L328) |
| `startVeryfrontServer` | Starts veryfront server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L539) |
| `toNodeHandler` | Convert a Web API request handler into a Node.js HTTP listener. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/node-handler.ts#L4) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `DevServer` | Implement dev server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/server.ts#L54) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `BuildOptions` | Build System Type Definitions Consolidated from cli/commands/build/types.ts and server/build-types.ts | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/build-types.ts#L6) |
| `BuildStats` | Public API contract for build stats. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/build-types.ts#L28) |
| `CreateVeryfrontServerOptions` | Options accepted by create veryfront server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L28) |
| `DevServerOptions` | Options accepted by dev server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts#L2) |
| `DiscoveryOptions` | Configuration for AI primitives discovery during server startup | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts#L118) |
| `FileWatcherMetrics` | Public API contract for file watcher metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts#L33) |
| `NodeVeryfrontServiceServer` | Public API contract for node veryfront service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L75) |
| `RouteDirectory` | Public API contract for route directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts#L27) |
| `ServerHandle` | Public API contract for server handle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts#L153) |
| `StartDevModeOptions` | Options accepted by start dev mode. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L101) |
| `StartNodeVeryfrontServerOptions` | Options accepted by start node veryfront server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L43) |
| `StartProductionModeOptions` | Options accepted by start production mode. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L110) |
| `StartProductionServerOptions` | Options accepted by start production server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts#L159) |
| `StartServerOptions` | Server options. Defaults to development mode with HMR. Set `mode: "production"` for a production server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L126) |
| `StartVeryfrontServerOptions` | Options accepted by start veryfront server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L53) |
| `VeryfrontHandler` | Web API request handler with WebSocket upgrade and HMR helpers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L141) |
| `VeryfrontServer` | Running server instance with lifecycle controls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L129) |
| `VeryfrontServiceServer` | Public API contract for veryfront service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L66) |
| `VeryfrontServiceServerFetch` | Public API contract for veryfront service server fetch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L5) |
| `VeryfrontServiceServerLogger` | Public API contract for veryfront service server logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L20) |
| `VeryfrontServiceServerModule` | Public API contract for veryfront service server module. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L10) |
| `VeryfrontServiceServerModuleResponse` | Response payload for veryfront service server module. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L7) |
| `VeryfrontServiceServerRuntime` | Public API contract for veryfront service server runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L36) |
| `VeryfrontServiceServerRuntimeKind` | Public API contract for veryfront service server runtime kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L63) |
