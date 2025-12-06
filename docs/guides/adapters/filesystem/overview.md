# Filesystem Adapters Overview

Veryfront's **filesystem abstraction layer** allows you to read project files from different sources - local disk, remote APIs, or custom storage - with a unified interface.

## What Are Filesystem Adapters?

Filesystem adapters provide a consistent API for reading files, regardless of where they're stored:

```typescript
// Same code works with any storage backend
const content = await fs.readFile('pages/index.tsx')
const files = await fs.readdir('pages/')
const exists = await fs.exists('components/Header.tsx')
```

## Why Filesystem Adapters?

###  Remote Rendering
Render projects stored on remote servers without downloading them locally.

###  Read-Only Production
Serve pre-built apps from read-only storage (CDN, S3, etc.).

###  Edge Computing
Access files from edge storage (Cloudflare KV, Deno KV) at runtime.

###  Testing & Development
Mock filesystem for testing without touching real files.

## Available Adapters

| Adapter | Use Case | Performance | Setup |
|---------|----------|-------------|-------|
| **Local Disk** | Development, traditional servers |  Native | Default |
| **Veryfront API** | Remote rendering, multi-tenant SaaS |  Cached | [Guide](./veryfront-api.md) |
| **Memory** | Testing, temporary builds |  In-memory | [Guide](/ai/README.md) |
| **Custom** | S3, CDN, database, etc. | Varies | [Guide](../README.md) |

## How It Works

### 1. Local Disk (Default)

Standard filesystem - reads files from disk. This is the default and requires no configuration.

```typescript
// veryfront.config.ts - No config needed!
export default defineConfig({
  // Uses local filesystem by default
})
```

**When to use:**
-  Development
-  Traditional deployments (VPS, Docker)
-  Files are on the same machine

### 2. Veryfront API (Remote)

Read project files from a remote Veryfront API server. Perfect for multi-tenant SaaS or distributed rendering.

```typescript
// veryfront.config.ts
export default defineConfig({
  fs: {
    type: 'veryfront-api',
    veryfront: {
      apiBaseUrl: 'https://api.veryfront.com',
      apiToken: process.env.VERYFRONT_API_TOKEN!,
      projectSlug: 'my-blog',
    }
  }
})
```

**When to use:**
-  Multi-tenant SaaS applications
-  Projects stored remotely (GitHub, Gitlab, etc.)
-  Distributed rendering clusters
-  Content management systems

[→ Learn more about Veryfront API](./veryfront-api.md)

### 3. Memory (Testing)

In-memory filesystem for testing and temporary builds.

```typescript
// veryfront.config.ts
export default defineConfig({
  fs: {
    type: 'memory',
    memory: {
      files: {
        'pages/index.tsx': 'export default function Home() { return <h1>Hello</h1> }',
        'veryfront.config.ts': 'export default {}',
      }
    }
  }
})
```

**When to use:**
-  Unit testing
-  Integration testing
-  CI/CD pipelines

### 4. Custom Adapters

Build your own adapter for S3, CDN, database, or any storage backend.

```typescript
import type { FSAdapter } from 'veryfront/platform'

class S3FSAdapter implements FSAdapter {
  async readFile(path: string): Promise<Uint8Array> {
    // Fetch from S3
    const response = await s3Client.getObject({ Bucket, Key: path })
    return new Uint8Array(await response.Body.transformToByteArray())
  }

  async readdir(path: string): Promise<string[]> {
    // List S3 objects
    const response = await s3Client.listObjectsV2({ Bucket, Prefix: path })
    return response.Contents?.map(obj => obj.Key!) || []
  }

  // ... implement other methods
}
```

[→ Learn more about custom adapters](../README.md)

## Architecture

```
┌─────────────────────────────────────────┐
│         Veryfront Framework             │
│  (Rendering, Routing, Build System)     │
└─────────────────────────────────────────┘
              ↓ uses
┌─────────────────────────────────────────┐
│      Filesystem Abstraction API         │
│  readFile(), readdir(), exists(), etc.  │
└─────────────────────────────────────────┘
              ↓ implements
┌─────────────────────────────────────────┐
│         Filesystem Adapter              │
│  ├─ Local Disk (default)                │
│  ├─ Veryfront API (remote)              │
│  ├─ Memory (testing)                    │
│  └─ Custom (S3, CDN, etc.)              │
└─────────────────────────────────────────┘
              ↓ reads from
┌─────────────────────────────────────────┐
│         Storage Backend                 │
│  Disk / API / Memory / S3 / CDN / DB    │
└─────────────────────────────────────────┘
```

## Performance Considerations

### Caching

All remote adapters (Veryfront API, S3, etc.) use intelligent caching:

```typescript
export default defineConfig({
  fs: {
    type: 'veryfront-api',
    veryfront: {
      apiBaseUrl: 'https://api.veryfront.com',
      apiToken: process.env.VERYFRONT_API_TOKEN!,
      projectSlug: 'my-blog',

      // Cache configuration
      cache: {
        enabled: true,
        ttl: 3600000,      // 1 hour in milliseconds
        maxSize: 100 * 1024 * 1024,  // 100 MB
      }
    }
  }
})
```

**Cache strategies:**
- **Development**: Short TTL (1-5 minutes) for fast iteration
- **Production**: Long TTL (1+ hours) for performance
- **High-traffic**: Aggressive caching with CDN in front

### Optimization Tips

1. **Prefetch files at startup** (Veryfront does this automatically)
2. **Use LRU cache** to limit memory usage
3. **Enable compression** for network transfer
4. **CDN front** for static assets

## Use Cases

### 🏢 SaaS Platform

**Scenario:** You're building a multi-tenant blog platform where each tenant's site is stored remotely.

```typescript
// Each request specifies the tenant
export default defineConfig({
  fs: {
    type: 'veryfront-api',
    veryfront: {
      apiBaseUrl: 'https://api.yoursaas.com',
      apiToken: process.env.API_TOKEN!,
      projectSlug: request.headers.get('X-Tenant-Slug')!, // Dynamic!
    }
  }
})
```

###  Testing Pipeline

**Scenario:** Running integration tests without writing to disk.

```typescript
// test-setup.ts
export default defineConfig({
  fs: {
    type: 'memory',
    memory: {
      files: {
        'pages/index.tsx': testPageContent,
        'pages/blog/[slug].tsx': testBlogPageContent,
      }
    }
  }
})
```

###  CDN-Backed Static Site

**Scenario:** Serving pre-built pages from CDN storage.

```typescript
export default defineConfig({
  fs: {
    type: 'custom',
    custom: new CDNFSAdapter({
      cdnUrl: 'https://cdn.example.com',
      bucket: 'my-static-site',
    })
  }
})
```

## Configuration Reference

### Local Disk (Default)

```typescript
export default defineConfig({
  fs: {
    type: 'local', // or omit entirely (default)
    local: {
      baseDir: './my-project', // Optional, defaults to projectDir
    }
  }
})
```

### Veryfront API

```typescript
export default defineConfig({
  fs: {
    type: 'veryfront-api',
    veryfront: {
      apiBaseUrl: string,        // Required: API base URL
      apiToken: string,          // Required: Authentication token
      projectSlug: string,       // Required: Project identifier
      cache?: {
        enabled?: boolean,       // Default: true
        ttl?: number,           // Default: 3600000 (1 hour)
        maxSize?: number,       // Default: 100MB
      },
      retry?: {
        maxRetries?: number,    // Default: 3
        initialDelay?: number,  // Default: 1000ms
        maxDelay?: number,      // Default: 10000ms
      }
    }
  }
})
```

### Memory

```typescript
export default defineConfig({
  fs: {
    type: 'memory',
    memory: {
      files: Record<string, string | Uint8Array>, // File contents
    }
  }
})
```

## Next Steps

Choose your filesystem adapter:

- [**Local Disk** - Standard filesystem (default)](/guides/adapters/filesystem/overview.md)
- [**Veryfront API** - Remote rendering & multi-tenant](./veryfront-api.md)
- [**Custom Adapters** - Build your own (S3, CDN, etc.)](../README.md)

## Learn More

- [Platform Adapters Overview](/guides/adapters/platform/overview.md)
- [Architecture Deep Dive](/guides/architecture/README.md)
- [Performance Optimization](/guides/performance/README.md)
