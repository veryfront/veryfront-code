# Veryfront API Filesystem Adapter

The **Veryfront API adapter** allows Veryfront to render projects stored on remote servers, enabling multi-tenant SaaS applications, distributed rendering, and content management systems.

## What Is Veryfront API?

Veryfront API is a **remote filesystem protocol** that lets you:

1. **Store projects remotely** (on your API server, GitHub, GitLab, etc.)
2. **Render on-demand** without downloading files locally
3. **Build multi-tenant** applications where each tenant has their own project
4. **Distribute rendering** across multiple servers

## Quick Start

### 1. Install Veryfront

```bash
deno add veryfront
```

### 2. Configure Remote Filesystem

```typescript
// veryfront.config.ts
import { defineConfig } from 'veryfront'

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

### 3. Set Environment Variable

```bash
export VERYFRONT_API_TOKEN="your-api-token-here"
```

### 4. Start Server

```bash
deno task dev
```

That's it! Veryfront will now fetch files from the remote API instead of reading from disk.

## Configuration

### Basic Configuration

```typescript
export default defineConfig({
  fs: {
    type: 'veryfront-api',
    veryfront: {
      // Required
      apiBaseUrl: 'https://api.veryfront.com',  // Your API endpoint
      apiToken: process.env.VERYFRONT_API_TOKEN!, // Authentication
      projectSlug: 'my-blog',                   // Project identifier
    }
  }
})
```

### Advanced Configuration

```typescript
export default defineConfig({
  fs: {
    type: 'veryfront-api',
    veryfront: {
      // Required
      apiBaseUrl: 'https://api.veryfront.com',
      apiToken: process.env.VERYFRONT_API_TOKEN!,
      projectSlug: 'my-blog',

      // Optional: Caching (recommended for production)
      cache: {
        enabled: true,              // Enable file caching
        ttl: 3600000,              // Cache TTL: 1 hour (in ms)
        maxSize: 100 * 1024 * 1024, // Max cache size: 100 MB
      },

      // Optional: Retry logic
      retry: {
        maxRetries: 3,      // Retry failed requests 3 times
        initialDelay: 1000, // Start with 1 second delay
        maxDelay: 10000,    // Max 10 second delay (exponential backoff)
      }
    }
  }
})
```

## API Specification

Your API server must implement the following endpoints:

### 1. List Projects

```http
GET /api/projects
Authorization: Bearer {apiToken}
```

**Response:**
```json
{
  "data": [
    {
      "id": "proj_abc123",
      "name": "My Blog",
      "slug": "my-blog",
      "description": "A personal blog",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-15T12:00:00Z"
    }
  ]
}
```

### 2. Get Project Details

```http
GET /api/projects/{projectId}
Authorization: Bearer {apiToken}
```

**Response:**
```json
{
  "id": "proj_abc123",
  "name": "My Blog",
  "slug": "my-blog",
  "description": "A personal blog",
  "provider": "github",
  "layout": "blog",
  "config": "{\"title\": \"My Blog\"}",
  "createdAt": "2024-01-01T00:00:00Z",
  "updatedAt": "2024-01-15T12:00:00Z"
}
```

### 3. List Files

```http
GET /api/projects/{projectId}/files?cursor={cursor}&limit={limit}
Authorization: Bearer {apiToken}
```

**Response:**
```json
{
  "data": [
    {
      "path": "pages/index.tsx",
      "size": 1024,
      "type": "file",
      "mimeType": "text/typescript",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-15T12:00:00Z"
    },
    {
      "path": "pages/blog",
      "size": 0,
      "type": "directory",
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-15T12:00:00Z"
    }
  ],
  "pagination": {
    "cursor": "eyJwYXRoIjoicGFnZXMvYmxvZyJ9",
    "hasMore": true
  }
}
```

### 4. Get File Content

```http
GET /api/projects/{projectId}/files/{path}
Authorization: Bearer {apiToken}
```

**Response:**
- **Content-Type**: Appropriate MIME type
- **Body**: Raw file contents

### 5. Get File Metadata

```http
HEAD /api/projects/{projectId}/files/{path}
Authorization: Bearer {apiToken}
```

**Response Headers:**
```http
Content-Length: 1024
Content-Type: text/typescript
Last-Modified: Wed, 15 Jan 2024 12:00:00 GMT
```

## Use Cases

### 1. Multi-Tenant SaaS

Render different projects for different tenants dynamically:

```typescript
import { defineConfig } from 'veryfront'

// Detect tenant from request
export default defineConfig({
  fs: {
    type: 'veryfront-api',
    veryfront: {
      apiBaseUrl: 'https://api.yoursaas.com',
      apiToken: process.env.API_TOKEN!,

      // Dynamic project slug based on tenant
      projectSlug: getTenantSlug(request),
    }
  }
})

function getTenantSlug(request: Request): string {
  // Extract from subdomain: tenant1.yoursaas.com
  const host = request.headers.get('host')!
  return host.split('.')[0]

  // Or from header
  // return request.headers.get('X-Tenant-Slug')!

  // Or from path
  // return new URL(request.url).pathname.split('/')[1]
}
```

### 2. GitHub-Backed CMS

Render projects stored in GitHub repositories:

```typescript
// Your API server fetches from GitHub
// GET /api/projects/my-blog/files/pages/index.tsx
//   → GitHub API: GET /repos/user/my-blog/contents/pages/index.tsx

export default defineConfig({
  fs: {
    type: 'veryfront-api',
    veryfront: {
      apiBaseUrl: 'https://your-github-proxy.com',
      apiToken: process.env.GITHUB_TOKEN!,
      projectSlug: 'user/my-blog', // GitHub repo
    }
  }
})
```

### 3. Distributed Rendering

Multiple rendering servers fetch from central storage:

```
┌──────────────────────┐
│  Central API Server  │  ← Stores all projects
│  (api.example.com)   │
└──────────────────────┘
          ↓ ↓ ↓
   ┌──────┴──┴──┴──────┐
   │                    │
┌──▼────┐  ┌──▼────┐  ┌▼──────┐
│ US-East│  │ EU-West│  │ Asia │  ← Rendering servers
│ Render │  │ Render │  │Render│     (fetch files on-demand)
└────────┘  └────────┘  └──────┘
```

```typescript
// On each rendering server
export default defineConfig({
  fs: {
    type: 'veryfront-api',
    veryfront: {
      apiBaseUrl: 'https://api.example.com', // Central storage
      apiToken: process.env.API_TOKEN!,
      projectSlug: 'my-blog',

      // Cache aggressively on render servers
      cache: {
        enabled: true,
        ttl: 3600000, // 1 hour
      }
    }
  }
})
```

## Performance Optimization

### 1. Prefetching

Veryfront automatically prefetches all files at startup:

```typescript
// Happens automatically on initialize()
const files = await client.listAllFiles()
cache.set('files:all', files)
```

This means:
-  Fast subsequent file reads (from cache)
-  No network latency after startup
-  Works offline after initial fetch

### 2. Caching Strategy

**Development:**
```typescript
cache: {
  enabled: true,
  ttl: 300000, // 5 minutes - fast iteration
}
```

**Production:**
```typescript
cache: {
  enabled: true,
  ttl: 3600000, // 1 hour - performance
}
```

**High-traffic production:**
```typescript
cache: {
  enabled: true,
  ttl: 86400000, // 24 hours - aggressive
  maxSize: 500 * 1024 * 1024, // 500 MB
}
```

### 3. Compression

Enable gzip/brotli compression on your API server:

```typescript
// API server (Express example)
app.use(compression())

app.get('/api/projects/:projectId/files/:path', async (req, res) => {
  const content = await getFileContent(req.params.path)
  res.set('Content-Encoding', 'gzip')
  res.send(gzipSync(content))
})
```

### 4. CDN Front

Put a CDN in front of your API:

```typescript
export default defineConfig({
  fs: {
    type: 'veryfront-api',
    veryfront: {
      apiBaseUrl: 'https://cdn.example.com', // CDN URL
      apiToken: process.env.API_TOKEN!,
      projectSlug: 'my-blog',
    }
  }
})
```

CDN benefits:
-  Faster file delivery (edge caching)
-  Reduced API server load
-  Lower latency globally

## Security

### Authentication

Always use environment variables for API tokens:

```typescript
//  DON'T: Hardcode tokens
apiToken: 'sk_live_abc123...'

//  DO: Use environment variables
apiToken: process.env.VERYFRONT_API_TOKEN!

//  DO: Validate token exists
if (!process.env.VERYFRONT_API_TOKEN) {
  throw new Error('VERYFRONT_API_TOKEN required')
}
```

### HTTPS Only

Always use HTTPS for API endpoints:

```typescript
//  DON'T: Use HTTP
apiBaseUrl: 'http://api.example.com'

//  DO: Use HTTPS
apiBaseUrl: 'https://api.example.com'
```

### Rate Limiting

Implement rate limiting on your API server:

```typescript
// API server (Express example)
import rateLimit from 'express-rate-limit'

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each token to 100 requests per window
})

app.use('/api', limiter)
```

### Token Rotation

Rotate API tokens periodically:

```bash
# Generate new token
new_token=$(generate_token)

# Update environment variable
export VERYFRONT_API_TOKEN="$new_token"

# Restart server
deno task restart
```

## Troubleshooting

### Project Not Found

**Error:**
```
VeryfrontAPIError: Project not found with slug: my-blog
```

**Solution:**
1. Check project slug is correct
2. Verify project exists in API
3. Check API token has access to project

### Network Errors

**Error:**
```
VeryfrontAPIError: Network request failed
```

**Solution:**
1. Check API base URL is correct
2. Verify API server is running
3. Check network connectivity
4. Review firewall rules

### Slow Performance

**Symptoms:**
- Slow page loads
- High latency

**Solutions:**
1. **Enable caching:**
   ```typescript
   cache: { enabled: true, ttl: 3600000 }
   ```

2. **Increase cache TTL:**
   ```typescript
   cache: { ttl: 86400000 } // 24 hours
   ```

3. **Use CDN:**
   ```typescript
   apiBaseUrl: 'https://cdn.example.com'
   ```

4. **Compress responses** on API server

### Cache Issues

**Problem:** Stale content after updates

**Solution:**
1. **Reduce TTL** for development:
   ```typescript
   cache: { ttl: 300000 } // 5 minutes
   ```

2. **Implement cache invalidation** on API server:
   ```typescript
   // When files change, send webhook to render servers
   POST /api/cache/invalidate
   { "projectSlug": "my-blog", "path": "pages/index.tsx" }
   ```

3. **Manual cache clear:**
   ```bash
   # Restart server to clear cache
   deno task restart
   ```

## Example API Server

Here's a minimal Express.js API server implementation:

```typescript
import express from 'express'
import { readFile, readdir, stat } from 'fs/promises'
import { join } from 'path'

const app = express()
const PROJECTS_DIR = './projects'

// Middleware
app.use(express.json())

// Authentication middleware
app.use((req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token || token !== process.env.API_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
})

// List projects
app.get('/api/projects', async (req, res) => {
  const projects = await readdir(PROJECTS_DIR)
  res.json({
    data: projects.map(slug => ({
      id: slug,
      slug,
      name: slug,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }))
  })
})

// Get project
app.get('/api/projects/:projectId', async (req, res) => {
  const { projectId } = req.params
  res.json({
    id: projectId,
    slug: projectId,
    name: projectId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
})

// List files
app.get('/api/projects/:projectId/files', async (req, res) => {
  const { projectId } = req.params
  const projectPath = join(PROJECTS_DIR, projectId)

  async function listAllFiles(dir: string): Promise<any[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    const files = []

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      const relativePath = fullPath.replace(projectPath + '/', '')
      const stats = await stat(fullPath)

      files.push({
        path: relativePath,
        size: stats.size,
        type: entry.isDirectory() ? 'directory' : 'file',
        createdAt: stats.birthtime.toISOString(),
        updatedAt: stats.mtime.toISOString(),
      })

      if (entry.isDirectory()) {
        files.push(...await listAllFiles(fullPath))
      }
    }

    return files
  }

  const files = await listAllFiles(projectPath)
  res.json({ data: files })
})

// Get file content
app.get('/api/projects/:projectId/files/*', async (req, res) => {
  const { projectId } = req.params
  const filePath = req.params[0]
  const fullPath = join(PROJECTS_DIR, projectId, filePath)

  try {
    const content = await readFile(fullPath)
    res.send(content)
  } catch (error) {
    res.status(404).json({ error: 'File not found' })
  }
})

// Get file metadata
app.head('/api/projects/:projectId/files/*', async (req, res) => {
  const { projectId } = req.params
  const filePath = req.params[0]
  const fullPath = join(PROJECTS_DIR, projectId, filePath)

  try {
    const stats = await stat(fullPath)
    res.set('Content-Length', stats.size.toString())
    res.set('Last-Modified', stats.mtime.toUTCString())
    res.status(200).end()
  } catch (error) {
    res.status(404).end()
  }
})

app.listen(3001, () => {
  console.log('API server running on http://localhost:3001')
})
```

## Next Steps

- [Filesystem Adapters Overview](./overview.md)
- [Custom Filesystem Adapters](./custom.md)
- [Platform Adapters](../platform-adapters/overview.md)
- [Performance Optimization Guide](../guides/performance.md)
