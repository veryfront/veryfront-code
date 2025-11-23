# Platform Adapters Overview

Veryfront is a **truly multi-runtime framework** that runs on Deno, Node.js, Bun, and Cloudflare Workers through a unified platform abstraction layer.

## What Are Platform Adapters?

Platform adapters provide a consistent API across different JavaScript runtimes, allowing you to write code once and deploy anywhere.

```typescript
// Same code works on all runtimes
import { fs, path, runtime } from '@veryfront/platform'

const content = await fs.readFile('page.tsx')
const normalized = path.join(projectDir, 'pages', 'index.tsx')
console.log(`Running on: ${runtime.name}`) // "deno" | "node" | "bun" | "cloudflare-workers"
```

## Supported Runtimes

| Runtime | Status | Best For | Deploy To |
|---------|--------|----------|-----------|
| **Deno** |  Primary | Modern apps, TypeScript-first | Deno Deploy, VPS, Docker |
| **Node.js** |  Supported | Enterprise, existing infra | Vercel, Railway, AWS, Azure |
| **Bun** |  Supported | Performance, fast cold starts | VPS, Docker |
| **Cloudflare Workers** |  Supported | Edge computing, global CDN | Cloudflare Workers |

## How It Works

### Automatic Detection

Veryfront automatically detects your runtime and uses the appropriate adapter:

```typescript
// Internally, Veryfront does:
import { detectRuntime, getAdapter } from '@veryfront/platform'

const runtime = detectRuntime() // Detects Deno/Node/Bun/CF
const adapter = getAdapter(runtime) // Gets the right adapter
```

### Unified APIs

All platform-specific operations go through adapters:

```typescript
// Filesystem operations
await adapter.fs.readFile(path)
await adapter.fs.writeFile(path, content)
await adapter.fs.readdir(path)

// HTTP server
await adapter.http.serve(handler, { port: 3000 })

// Environment variables
const value = adapter.env.get('API_KEY')

// Process operations
const cwd = adapter.process.cwd()
```

## Platform-Specific Features

### Deno Features
- Native TypeScript support
- Deno KV for caching
- Fresh-style file watching
- Web standard APIs

### Node.js Features
- npm ecosystem compatibility
- CommonJS and ESM support
- Node-specific modules (fs, http)
- Wide hosting support

### Bun Features
- Ultra-fast cold starts
- Built-in bundler
- npm compatibility
- Fast filesystem operations

### Cloudflare Workers Features
- Edge deployment globally
- KV storage for caching
- R2 for assets
- Durable Objects support

## Choosing a Runtime

### Use Deno When:
-  Starting a new project
-  You want native TypeScript
-  You prefer modern, secure APIs
-  You want Deno Deploy's simplicity

### Use Node.js When:
-  You have existing Node.js infrastructure
-  You need specific npm packages
-  You're migrating from Next.js
-  Your team knows Node.js

### Use Bun When:
-  You need maximum performance
-  Fast cold starts are critical
-  You want drop-in Node.js replacement
-  You're building CLI tools

### Use Cloudflare Workers When:
-  You need global edge deployment
-  You want minimal latency worldwide
-  You have static assets on R2/CDN
-  You're building serverless apps

## Configuration

No configuration needed! Veryfront automatically adapts to your runtime.

However, you can configure runtime-specific options:

```typescript
// veryfront.config.ts
export default defineConfig({
  // Deno-specific
  cache: {
    render: {
      type: 'kv', // Use Deno KV
    }
  },

  // Node.js-specific
  build: {
    target: 'node18', // Node.js version
  },

  // Cloudflare-specific
  cache: {
    render: {
      type: 'kv', // Use Cloudflare KV
    }
  },
})
```

## Next Steps

Choose your runtime to see detailed setup instructions:

- [**Deno** - Native TypeScript, Deno Deploy](./deno.md)
- [**Node.js** - Enterprise ready, wide hosting](./nodejs.md)
- [**Bun** - Ultra-fast, Node.js compatible](./bun.md)
- [**Cloudflare Workers** - Global edge deployment](./cloudflare.md)

## Learn More

- [Platform Abstraction Architecture](../advanced/architecture.md#platform-abstraction)
- [Custom Platform Adapters](../advanced/custom-adapters.md)
- [Deployment Guide](../guides/deployment.md)
