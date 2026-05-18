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

| Name | Description |
|------|-------------|
| `ReloadNotifier` |  |

### Functions

| Name | Description |
|------|-------------|
| `createHandler` |  |
| `createVeryfrontServer` |  |
| `startDevServer` |  |
| `startNodeVeryfrontServer` |  |
| `startProductionServer` |  |
| `startServer` | Start a Veryfront server in development or production mode. |
| `startVeryfrontServer` |  |
| `toNodeHandler` |  |

### Classes

| Name | Description |
|------|-------------|
| `DevServer` |  |

### Types

| Name | Description |
|------|-------------|
| `BaseServerOptions` | Shared options for both development and production server modes. |
| `BuildOptions` | Build System Type Definitions |
| `BuildStats` |  |
| `CreateVeryfrontServerOptions` |  |
| `DevServerOptions` |  |
| `DiscoveryOptions` | Configuration for AI primitives discovery during server startup |
| `FileWatcherMetrics` |  |
| `NodeVeryfrontServiceServer` |  |
| `RouteDirectory` |  |
| `ServerHandle` |  |
| `StartDevModeOptions` |  |
| `StartNodeVeryfrontServerOptions` |  |
| `StartProductionModeOptions` |  |
| `StartProductionServerOptions` |  |
| `StartServerOptions` | Server options. Defaults to development mode with HMR. |
| `StartVeryfrontServerOptions` |  |
| `VeryfrontHandler` | Web API request handler with WebSocket upgrade and HMR helpers. |
| `VeryfrontServer` | Running server instance with lifecycle controls. |
| `VeryfrontServiceServer` |  |
| `VeryfrontServiceServerFetch` |  |
| `VeryfrontServiceServerLogger` |  |
| `VeryfrontServiceServerModule` |  |
| `VeryfrontServiceServerModuleResponse` |  |
| `VeryfrontServiceServerRuntime` |  |
| `VeryfrontServiceServerRuntimeKind` |  |

## Related

User guides:

- [deploying](../../guides/deploying.md): Deploy the server

Architecture:

- [11-server-runtime](../../architecture/11-server-runtime.md): Server runtime architecture
