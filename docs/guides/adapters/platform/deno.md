# Deno Platform Adapter

**Deno** is the **primary and recommended runtime** for Veryfront. It offers native TypeScript support, modern Web APIs, and seamless deployment to Deno Deploy.

## Why Deno?

###  Advantages

1. **Native TypeScript** - No compilation needed during development
2. **Modern APIs** - Web standard APIs (fetch, WebSocket, etc.)
3. **Secure by Default** - Explicit permissions for file system, network
4. **Built-in Tools** - Formatter, linter, test runner included
5. **Fast** - V8 engine with optimized module loading
6. **Deno Deploy** - One-command deployment to edge network

###  Considerations

- Smaller ecosystem than Node.js (but growing fast)
- Some npm packages may need compatibility shims
- Newer runtime (less battle-tested than Node.js)

## Installation

### 1. Install Deno

**macOS/Linux:**
```bash
curl -fsSL https://deno.land/install.sh | sh
```

**Windows:**
```powershell
irm https://deno.land/install.ps1 | iex
```

**Homebrew:**
```bash
brew install deno
```

**Verify installation:**
```bash
deno --version
```

### 2. Create Veryfront Project

```bash
# Create project
mkdir my-veryfront-app
cd my-veryfront-app

# Initialize Deno project
deno init

# Add Veryfront
deno add veryfront react react-dom
```

### 3. Configure deno.json

**deno.json:**
```json
{
  "tasks": {
    "dev": "deno run --allow-all --unstable-kv node_modules/veryfront/cli.ts dev",
    "build": "deno run --allow-all --unstable-kv node_modules/veryfront/cli.ts build",
    "preview": "deno run --allow-all --unstable-kv node_modules/veryfront/cli.ts preview",
    "test": "deno test --allow-all"
  },
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  },
  "imports": {
    "veryfront": "npm:veryfront",
    "react": "npm:react@18",
    "react-dom": "npm:react-dom@18"
  }
}
```

## Development

### Start Dev Server

```bash
deno task dev
```

This starts:
- Development server on http://localhost:3000
- Hot Module Replacement (HMR)
- React Fast Refresh
- TypeScript checking

### Permissions

Veryfront needs these Deno permissions:

| Permission | Reason |
|------------|--------|
| `--allow-read` | Read project files, pages, components |
| `--allow-write` | Write cache, build output |
| `--allow-net` | Start HTTP server, fetch data |
| `--allow-env` | Read environment variables |
| `--allow-run` | Run build tools (esbuild) |
| `--unstable-kv` | Use Deno KV for caching |

**Development (all permissions):**
```bash
deno run --allow-all --unstable-kv node_modules/veryfront/cli.ts dev
```

**Production (specific permissions):**
```bash
deno run \
  --allow-read=. \
  --allow-write=./dist,./cache \
  --allow-net \
  --allow-env \
  --unstable-kv \
  node_modules/veryfront/cli.ts build
```

## Configuration

### Basic Configuration

**veryfront.config.ts:**
```typescript
import { defineConfig } from 'veryfront'

export default defineConfig({
  title: 'My Deno App',
  description: 'Built with Veryfront and Deno',

  dev: {
    port: 3000,
    hmr: true,
  },

  build: {
    outDir: 'dist',
  },
})
```

### Deno-Specific Configuration

**Using Deno KV for Caching:**

```typescript
import { defineConfig } from 'veryfront'

export default defineConfig({
  // Use Deno KV for render cache
  cache: {
    render: {
      type: 'kv',              // Use Deno KV
      ttl: 3600000,           // 1 hour
      kvPath: './cache.db',   // KV database path
    },
    bundleManifest: {
      type: 'kv',
      enabled: true,
    }
  },
})
```

**Deno-Specific Import Maps:**

```typescript
import { defineConfig } from 'veryfront'

export default defineConfig({
  resolve: {
    importMap: {
      imports: {
        // Use jsr: imports
        '@std/path': 'jsr:@std/path@^0.220.0',
        '@std/fs': 'jsr:@std/fs@^0.220.0',

        // Or npm: imports
        'lodash': 'npm:lodash@^4.17.21',
      }
    }
  }
})
```

## Building

### Development Build

```bash
deno task dev
```

- Fast rebuilds with HMR
- Source maps enabled
- No minification
- Detailed error messages

### Production Build

```bash
deno task build
```

This creates `dist/` with:
```
dist/
├── pages/              # Pre-rendered HTML pages (SSG)
├── client/             # Client-side JavaScript bundles
├── server.js           # Server bundle for SSR
├── assets/             # Optimized images, CSS, fonts
└── manifest.json       # Build manifest
```

**Build output:**
- Minified JavaScript
- Tree-shaken bundles
- Optimized images (WebP/AVIF)
- Compiled CSS (with Tailwind if configured)

### Preview Production Build

```bash
deno task preview
```

Serves production build on http://localhost:8000

## Deployment

### Option 1: Deno Deploy (Recommended)

**Deno Deploy** is a globally distributed edge runtime:

#### Quick Deploy

```bash
# Install deployctl
deno install -Arf jsr:@deno/deployctl

# Deploy (automatic builds)
deployctl deploy \
  --project=my-app \
  --prod \
  --entrypoint=dist/server.js
```

#### GitHub Integration

1. **Push to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/username/my-app.git
   git push -u origin main
   ```

2. **Connect on Deno Deploy:**
   - Go to [dash.deno.com](https://dash.deno.com/)
   - Click "New Project"
   - Connect GitHub repository
   - Set entrypoint: `dist/server.js`
   - Deploy!

#### Environment Variables

Set environment variables in Deno Deploy dashboard:

```
VERYFRONT_API_TOKEN=sk_live_xxx
DATABASE_URL=postgresql://...
```

Or via CLI:
```bash
deployctl deploy \
  --project=my-app \
  --prod \
  --env=VERYFRONT_API_TOKEN=sk_live_xxx
```

### Option 2: Deno + Docker

**Dockerfile:**
```dockerfile
FROM denoland/deno:1.40.0

WORKDIR /app

# Copy project files
COPY . .

# Install dependencies
RUN deno cache --unstable-kv node_modules/veryfront/cli.ts

# Build application
RUN deno task build

# Expose port
EXPOSE 8000

# Start server
CMD ["deno", "run", "--allow-all", "--unstable-kv", "dist/server.js"]
```

**Build and run:**
```bash
docker build -t my-veryfront-app .
docker run -p 8000:8000 my-veryfront-app
```

### Option 3: VPS (Ubuntu/Debian)

```bash
# Install Deno
curl -fsSL https://deno.land/install.sh | sh

# Clone repository
git clone https://github.com/username/my-app.git
cd my-app

# Build
deno task build

# Run with systemd
sudo systemctl start my-veryfront-app
```

**systemd service file** (`/etc/systemd/system/my-veryfront-app.service`):
```ini
[Unit]
Description=My Veryfront App
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/my-app
ExecStart=/home/www-data/.deno/bin/deno run --allow-all --unstable-kv dist/server.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

### Option 4: Fly.io

**fly.toml:**
```toml
app = "my-veryfront-app"

[build]
  dockerfile = "Dockerfile"

[[services]]
  internal_port = 8000
  protocol = "tcp"

  [[services.ports]]
    handlers = ["http"]
    port = 80

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443
```

**Deploy:**
```bash
flyctl launch
flyctl deploy
```

## Deno-Specific Features

### 1. Deno KV Caching

Use Deno's built-in key-value store for caching:

```typescript
// veryfront.config.ts
export default defineConfig({
  cache: {
    render: {
      type: 'kv',
      ttl: 3600000,
      kvPath: './cache.db',
    }
  }
})
```

**Benefits:**
-  Built-in (no external dependencies)
-  Fast (local database)
-  Persistent across restarts
-  ACID transactions

### 2. JSR Packages

Use JSR (JavaScript Registry) packages:

```typescript
// deno.json
{
  "imports": {
    "@std/path": "jsr:@std/path@^0.220.0",
    "@std/fs": "jsr:@std/fs@^0.220.0"
  }
}
```

```typescript
// pages/index.tsx
import { join } from '@std/path'
import { exists } from '@std/fs'

export const getServerData = async () => {
  const filePath = join(Deno.cwd(), 'data', 'posts.json')
  const fileExists = await exists(filePath)

  return { props: { fileExists } }
}
```

### 3. Native TypeScript

No compilation needed:

```typescript
// pages/api/users.ts
import type { APIHandler } from 'veryfront'

interface User {
  id: number
  name: string
  email: string
}

export const GET: APIHandler = async () => {
  const users: User[] = [
    { id: 1, name: 'John', email: 'john@example.com' },
    { id: 2, name: 'Jane', email: 'jane@example.com' },
  ]

  return new Response(JSON.stringify(users), {
    headers: { 'Content-Type': 'application/json' }
  })
}
```

### 4. Web Standard APIs

Use modern Web APIs directly:

```typescript
// Fetch API
const response = await fetch('https://api.example.com/data')
const data = await response.json()

// WebSocket
const ws = new WebSocket('wss://example.com/socket')

// Crypto
const hash = await crypto.subtle.digest(
  'SHA-256',
  new TextEncoder().encode('hello')
)

// URL
const url = new URL('/api/users', 'https://example.com')
```

## Performance

### Deno Performance Tips

1. **Use Deno KV for Caching:**
   ```typescript
   cache: { render: { type: 'kv' } }
   ```

2. **Enable Bundle Caching:**
   ```typescript
   cache: {
     bundleManifest: {
       type: 'kv',
       enabled: true,
     }
   }
   ```

3. **Use --unstable-kv:**
   Required for Deno KV features

4. **HTTP/2 Support:**
   Deno natively supports HTTP/2 (faster than HTTP/1.1)

5. **Fast Module Loading:**
   Deno caches modules in `~/.cache/deno`

### Benchmarks

Typical performance on Deno:

| Metric | Value |
|--------|-------|
| Cold start | ~100ms |
| Hot reload (HMR) | ~50ms |
| Page render (SSR) | ~10-30ms |
| Build time (100 pages) | ~5s |

## Troubleshooting

### Permission Errors

**Error:**
```
error: Requires read access to "pages"
```

**Solution:**
Add `--allow-read` or `--allow-all`:
```bash
deno run --allow-all node_modules/veryfront/cli.ts dev
```

### KV Database Errors

**Error:**
```
error: Deno.openKv is not a function
```

**Solution:**
Add `--unstable-kv` flag:
```bash
deno run --allow-all --unstable-kv node_modules/veryfront/cli.ts dev
```

### Import Errors

**Error:**
```
error: Module not found "veryfront"
```

**Solution:**
Add to `deno.json`:
```json
{
  "imports": {
    "veryfront": "npm:veryfront"
  }
}
```

### Build Failures

**Error:**
```
error: Build failed
```

**Solutions:**
1. Clear cache: `rm -rf .veryfront`
2. Reinstall: `deno cache --reload node_modules/veryfront/cli.ts`
3. Check permissions: `deno run --allow-all ...`

## Migration from Node.js

If you're migrating from Node.js:

### 1. Update Imports

```typescript
// Before (Node.js)
const path = require('path')
const fs = require('fs')

// After (Deno)
import { join } from '@std/path'
import { readFile } from '@std/fs'
```

### 2. Use Deno APIs

```typescript
// Before (Node.js)
process.env.API_KEY
__dirname

// After (Deno)
Deno.env.get('API_KEY')
Deno.cwd()
```

### 3. Update package.json → deno.json

See [Configuration](#configuration) section above.

## Next Steps

- [Filesystem Adapters](../filesystem-adapters/overview.md) - Use remote storage
- [Deployment Guide](../guides/deployment.md) - Advanced deployment
- [Performance](../guides/performance.md) - Optimization tips
- [Other Runtimes](./overview.md) - Node.js, Bun, Cloudflare

## Resources

- [Deno Manual](https://deno.land/manual)
- [Deno Deploy Docs](https://deno.com/deploy/docs)
- [JSR Registry](https://jsr.io/)
- [Deno Standard Library](https://deno.land/std)
