# Server Module

The Server module provides development and production server implementations with HMR, file watching, and universal request handling.

## Import Map Alias

```typescript
// Using import map alias (recommended)
import { createDevServer, createVeryfrontHandler, startUniversalServer } from "#server";

// Using barrel file
import { createDevServer, createVeryfrontHandler, startUniversalServer } from "./server/index.ts";
```

## Public API Overview

The Server module exports:

- **`createDevServer()`** - Creates a development server with HMR and file watching
- **`DevServer`** - Development server class
- **`startUniversalServer()`** - Starts a production server
- **`createVeryfrontHandler()`** - Creates a universal request handler for any runtime

## File Structure

```
server/
├── index.ts                      # Public API (barrel file) ← USE THIS
├── README.md                     # This file
├── dev-server.ts                 # Development server implementation
├── dev-server/                   # Dev server internals
│   ├── file-watch-setup.ts
│   ├── hmr-server.ts
│   ├── hmr-types.ts
│   ├── hmr/                      # HMR implementation
│   ├── request-handler.ts
│   ├── route-discovery.ts
│   └── server.ts
├── production-server.ts          # Production server
├── universal-handler/            # Runtime-agnostic handler
│   ├── index.ts
│   └── handler.ts
├── build/                        # Build system
│   ├── index.ts (barrel)
│   ├── asset-generation.ts
│   ├── client-runtime.ts
│   ├── manifest.ts
│   ├── static-generation.ts
│   └── build/                    # Build orchestration
│       ├── index.ts (barrel)
│       ├── build-executor.ts
│       ├── build-initializer.ts
│       └── build-orchestrator.ts
├── modules/                      # Server modules
│   ├── index.ts (barrel)
│   ├── api-server.ts             # API module server
│   ├── module-server.ts          # HMR module server
│   ├── rate-limiter.ts           # Rate limiting
│   └── websocket-handler.ts      # WebSocket support
├── handlers/                     # Request handlers
│   ├── types.ts
│   ├── monitoring/               # Health/metrics endpoints
│   ├── request/                  # Request routing
│   └── routing/                  # Route registry
└── rsc-endpoints/                # RSC endpoints
    ├── endpoint-router.ts
    └── types.ts
```

## Quick Start

### Development Server

```ts
import { createDevServer } from "#server";
import { getConfig } from "#config";
import { cwd } from "../../platform/compat/process.ts"; // Assuming cwd is available from compat

const config = await getConfig(cwd());
const server = await createDevServer({
  projectDir: cwd(),
  config,
  port: 3000,
});

await server.start();
console.log("Dev server running on http://localhost:3000");
```

### Production Server

```ts
import { startUniversalServer } from "#server";
import { cwd } from "../../platform/compat/process.ts"; // Assuming cwd is available from compat

await startUniversalServer({
  projectDir: cwd(),
  port: 8000,
  hostname: "0.0.0.0",
});

console.log("Production server running on http://0.0.0.0:8000");
```

### Universal Handler (for custom runtimes)

```ts
import { createVeryfrontHandler } from "#server";
import { getConfig } from "#config";
import { getAdapter } from "#adapters";
import { cwd } from "../../platform/compat/process.ts"; // Assuming cwd is available from compat

const adapter = await getAdapter();
const config = await getConfig(cwd(), adapter);

const handler = await createVeryfrontHandler({
  projectDir: cwd(),
  config,
  adapter,
  mode: "production",
});

// Use with any HTTP server
const server = Deno.serve(handler);
```

## Features

### Development Server

- **Hot Module Replacement (HMR)**: Instant updates without full page reload
- **File Watching**: Automatically rebuilds on file changes
- **Error Overlay**: In-browser error reporting
- **Route Discovery**: Automatically discovers API and page routes
- **Module Server**: Serves transformed modules for HMR

### Production Server

- **Optimized Performance**: Pre-bundled assets and server-side rendering
- **Universal Handler**: Works with Deno, Node, Bun, Cloudflare Workers
- **Static Generation**: Pre-renders pages at build time (SSG)
- **Incremental Static Regeneration (ISR)**: Updates static pages on-demand
- **API Routes**: Serverless API endpoints

### Build System

Available via `#server/build` alias:

- **Asset Generation**: Optimizes CSS, images, and client bundles
- **Client Runtime**: Hydration and client-side navigation
- **Manifest Generation**: Build manifest with asset hashes
- **Static Generation**: SSG with parallel page rendering

## Configuration

### Dev Server Options

```ts
interface DevServerOptions {
  projectDir: string;
  config: VeryfrontConfig;
  port?: number;
  hostname?: string;
  hmr?: boolean;
  watch?: boolean;
}
```

### Production Server Options

```ts
interface ProductionServerOptions {
  projectDir: string;
  port?: number;
  hostname?: string;
  config?: VeryfrontConfig;
}
```

### Universal Handler Options

```ts
interface UniversalHandlerOptions {
  projectDir: string;
  config: VeryfrontConfig;
  adapter: RuntimeAdapter;
  mode: "development" | "production";
  port?: number;
}
```

## Sub-Modules

### server/build

Build system exports - see [server/build/README.md](build/README.md)

### server/modules

Server-side modules:

- **API Server**: Serves API routes with dynamic import
- **Module Server**: Serves HMR-enabled ES modules
- **Rate Limiter**: Request rate limiting
- **WebSocket Handler**: WebSocket support for HMR

## Best Practices

1. **Use the universal handler** for deployment flexibility
2. **Enable HMR in development** for faster iteration
3. **Pre-render static pages** in production for better performance
4. **Configure rate limiting** for API routes to prevent abuse
5. **Use graceful shutdown** to finish pending requests before stopping

## Related Modules

- **#rendering** - SSR and RSC rendering
- **#api** - API route handling
- **#middleware** - Request pipeline
- **#adapters** - Runtime compatibility

## References

- [Deployment Guide](../../docs/deployment.md)
- [Security Guide](../../docs/security.md)
- [Build System Guide](build/README.md)
