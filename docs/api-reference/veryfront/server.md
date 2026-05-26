---
title: "veryfront/server"
description: "Server runtime APIs. Creates and runs a Veryfront server in tests, custom runtimes, and production adapters."
order: 26
---

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
| `ReloadNotifier` | Render reload notifier. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/reload-notifier.ts#L158) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createHandler` | Create a Veryfront request handler for development or production. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L193) |
| `createVeryfrontServer` | Create veryfront server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L148) |
| `startDevServer` | Starts dev server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/index.ts#L14) |
| `startNodeVeryfrontServer` | Starts node veryfront server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L558) |
| `startProductionServer` | Starts production server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts#L162) |
| `startServer` | Start a Veryfront server in development or production mode. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L327) |
| `startVeryfrontServer` | Starts veryfront server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L538) |
| `toNodeHandler` | Convert a Web API request handler into a Node.js HTTP listener. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/node-handler.ts#L3) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `DevServer` | Implement dev server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/server.ts#L53) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `BuildOptions` | Build System Type Definitions Consolidated from cli/commands/build/types.ts and server/build-types.ts | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/build-types.ts#L5) |
| `BuildStats` | Public API contract for build stats. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/build-types.ts#L27) |
| `CreateVeryfrontServerOptions` | Options accepted by create veryfront server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L27) |
| `DevServerOptions` | Options accepted by dev server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts#L1) |
| `DiscoveryOptions` | Configuration for AI primitives discovery during server startup | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts#L113) |
| `FileWatcherMetrics` | Public API contract for file watcher metrics. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts#L32) |
| `NodeVeryfrontServiceServer` | Public API contract for node veryfront service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L74) |
| `RouteDirectory` | Public API contract for route directory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts#L26) |
| `ServerHandle` | Public API contract for server handle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts#L148) |
| `StartDevModeOptions` | Options accepted by start dev mode. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L100) |
| `StartNodeVeryfrontServerOptions` | Options accepted by start node veryfront server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L42) |
| `StartProductionModeOptions` | Options accepted by start production mode. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L109) |
| `StartProductionServerOptions` | Options accepted by start production server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts#L154) |
| `StartServerOptions` | Server options. Defaults to development mode with HMR. Set `mode: "production"` for a production server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L125) |
| `StartVeryfrontServerOptions` | Options accepted by start veryfront server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L52) |
| `VeryfrontHandler` | Web API request handler with WebSocket upgrade and HMR helpers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L140) |
| `VeryfrontServer` | Running server instance with lifecycle controls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L128) |
| `VeryfrontServiceServer` | Public API contract for veryfront service server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L65) |
| `VeryfrontServiceServerFetch` | Public API contract for veryfront service server fetch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L4) |
| `VeryfrontServiceServerLogger` | Public API contract for veryfront service server logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L19) |
| `VeryfrontServiceServerModule` | Public API contract for veryfront service server module. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L9) |
| `VeryfrontServiceServerModuleResponse` | Response payload for veryfront service server module. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L6) |
| `VeryfrontServiceServerRuntime` | Public API contract for veryfront service server runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L35) |
| `VeryfrontServiceServerRuntimeKind` | Public API contract for veryfront service server runtime kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L62) |
