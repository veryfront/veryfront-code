---
title: "veryfront/server"
description: "Composable service server API."
order: 28
---

# veryfront/server

Composable service server API.

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

## Framework server

| Export                    | Use                                                                               |
| ------------------------- | --------------------------------------------------------------------------------- |
| `createHandler()`         | Create a Web API request handler for development or production mode.              |
| `startServer()`           | Start a Veryfront development or production server and return lifecycle controls. |
| `toNodeHandler()`         | Adapt a Web API handler to a Node HTTP request listener.                          |
| `DevServer`               | Development server class with HMR and file watching.                              |
| `startDevServer()`        | Start the development server directly.                                            |
| `startProductionServer()` | Start the production server directly.                                             |
| `ReloadNotifier`          | Broadcast reload notifications to connected development clients.                  |

## Service server

Use the service server helpers when a package feature needs a small composable
HTTP runtime rather than a full app server.

| Export                          | Use                                                 |
| ------------------------------- | --------------------------------------------------- |
| `createVeryfrontServer()`       | Compose named modules into one request handler.     |
| `startVeryfrontServer()`        | Start the service server on the current runtime.    |
| `startNodeVeryfrontServer()`    | Start the service server with the Node adapter.     |
| `VeryfrontServiceServerModule`  | Module contract for service-server composition.     |
| `VeryfrontServiceServerRuntime` | Runtime bundle returned by service-server creation. |
| `VeryfrontServiceServer`        | Cross-runtime service-server lifecycle shape.       |
| `NodeVeryfrontServiceServer`    | Node-specific service-server lifecycle shape.       |

## Types

The module exports option and lifecycle types for development mode, production
mode, route discovery, build output, service-server composition, and HMR
connection handling.
