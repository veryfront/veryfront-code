---
title: "veryfront/server"
description: "Server Module Public API This module exports the public interface for the Veryfront server. For routing utilities, import from \"#veryfront/routing\" directly. For observability utilities, import from \"#veryfront/observability\" directly."
order: 28
---

# veryfront/server

Server Module Public API This module exports the public interface for the Veryfront server. For routing utilities, import from "#veryfront/routing" directly. For observability utilities, import from "#veryfront/observability" directly.

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
| `ReloadNotifier` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/reload-notifier.ts#L157) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createHandler` | Create a Veryfront request handler for development or production. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L192) |
| `createVeryfrontServer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L136) |
| `startDevServer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/index.ts#L13) |
| `startNodeVeryfrontServer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L544) |
| `startProductionServer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts#L163) |
| `startServer` | Start a Veryfront server in development or production mode. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L326) |
| `startVeryfrontServer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L525) |
| `toNodeHandler` | Convert a Web API request handler into a Node.js HTTP listener. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/node-handler.ts#L3) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `DevServer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/server.ts#L52) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `BaseServerOptions` | Shared options for both development and production server modes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L82) |
| `BuildOptions` | Build System Type Definitions Consolidated from cli/commands/build/types.ts and server/build-types.ts | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/build-types.ts#L5) |
| `BuildStats` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/build-types.ts#L26) |
| `CreateVeryfrontServerOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L22) |
| `DevServerOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts) |
| `DiscoveryOptions` | Configuration for AI primitives discovery during server startup | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts#L117) |
| `FileWatcherMetrics` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts#L29) |
| `NodeVeryfrontServiceServer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L63) |
| `RouteDirectory` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/dev-server/types.ts#L24) |
| `ServerHandle` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts#L151) |
| `StartDevModeOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L100) |
| `StartNodeVeryfrontServerOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L35) |
| `StartProductionModeOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L108) |
| `StartProductionServerOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/production-server.ts#L156) |
| `StartServerOptions` | Server options. Defaults to development mode with HMR. Set `mode: "production"` for a production server. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L124) |
| `StartVeryfrontServerOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L44) |
| `VeryfrontHandler` | Web API request handler with WebSocket upgrade and HMR helpers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L139) |
| `VeryfrontServer` | Running server instance with lifecycle controls. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/index.ts#L127) |
| `VeryfrontServiceServer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L55) |
| `VeryfrontServiceServerFetch` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L3) |
| `VeryfrontServiceServerLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L15) |
| `VeryfrontServiceServerModule` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L6) |
| `VeryfrontServiceServerModuleResponse` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L4) |
| `VeryfrontServiceServerRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L29) |
| `VeryfrontServiceServerRuntimeKind` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/server/service-server.ts#L53) |

## Related

User guides:

- [deploying](../../guides/deploying.md): Deploy the server

Architecture:

- [04-server-runtime](../../architecture/04-server-runtime.md): Server runtime architecture
