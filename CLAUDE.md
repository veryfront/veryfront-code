# Veryfront Renderer

Zero-config React meta-framework with AI-native capabilities. Contains both the **Proxy** (OAuth token management) and **Renderer** (SSR/RSC engine).

## Quick Reference

| Component | Container | Port | Runtime |
|-----------|-----------|------|---------|
| Proxy | `proxy` | 20000 | Deno |
| Renderer | `renderer` | 20000 | Deno |

## Tech Stack

- **Runtime**: Deno 2.6+
- **Package Manager**: deno (native)
- **Linter**: deno lint
- **Formatter**: deno fmt
- **Test Framework**: Deno test
- **Build**: esbuild

## Architecture

```
veryfront-renderer/
├── proxy/                 # OAuth token proxy (separate service)
│   ├── main.ts           # Entry point
│   ├── token-manager.ts  # Token lifecycle
│   └── cache/            # Memory/Redis caching
├── src/                   # Main framework
│   ├── ai/               # Agent runtime, MCP, workflows
│   ├── build/            # Production builds, transforms
│   ├── cli/              # CLI commands (dev, build)
│   ├── core/             # Config, errors, types, utils, oauth
│   ├── data/             # Data fetching
│   ├── html/             # HTML utilities
│   ├── middleware/       # Request middleware
│   ├── module-system/    # Module resolution
│   ├── observability/    # Tracing, logging
│   ├── platform/         # Multi-runtime adapters
│   ├── react/            # React components
│   ├── rendering/        # SSR, RSC, client rendering
│   ├── routing/          # File-based routing, API routes
│   ├── security/         # Security utilities
│   └── server/           # Dev & production servers
├── chart/                 # Helm chart (deploys both)
├── tests/                 # Integration tests
├── deno.json             # Main Deno config
└── veryfront.config.ts   # Framework config
```

## Two Operation Modes

### Proxy Mode (Production)
```
Client → Proxy → Renderer → API
         ↓
   Token cache (Redis)
```
- Proxy handles OAuth tokens per-request
- Renderer receives token via `x-token` header
- Enable with `PROXY_MODE=1`

### Direct Mode (Local Dev)
```
Client → Renderer → API
              ↓
         Token from env
```
- Token from `VERYFRONT_API_TOKEN` env var
- Single project from `VERYFRONT_PROJECT_SLUG`
- Enable with `PROXY_MODE=0`

## Development Commands

### Renderer (Deno)
```bash
deno task dev              # Start dev server (single project)
deno task dev:multi        # Multi-project mode (Veryfront staff)
deno task build            # Production build
deno task test             # Run all tests
deno task test:unit        # Run unit tests only
deno task test:integration # Run integration tests only
deno task lint             # Lint code
deno task fmt              # Format code
deno task typecheck        # Type check
```

### Proxy (Deno)
```bash
cd proxy
deno task start            # Production run
deno task dev              # With file watching
deno check main.ts         # Type check proxy only
```

## Configuration

### veryfront.config.ts
```typescript
export default {
  fs: {
    type: "veryfront-api",
    veryfront: {
      baseUrl: "http://api.lvh.me:4000",
      proxyMode: true,      // Use proxy headers
      cache: { enabled: true, ttl: 60000 },
    }
  },
  dev: { port: 3001, hmr: true }
}
```

### Environment Variables

**Renderer:**
```bash
PROXY_MODE=0                              # 0=direct, 1=proxy
VERYFRONT_API_TOKEN=vf_...               # API token (direct mode)
VERYFRONT_PROJECT_SLUG=my-project        # Project slug (direct mode)
PRODUCTION_MODE=1                         # Use releases (not draft)
```

**Proxy:**
```bash
OAUTH_CLIENT_ID=...                       # Production OAuth
OAUTH_CLIENT_SECRET=...
RENDERER_URL=http://veryfront-renderer:80 # Internal renderer URL
CACHE_TYPE=redis                          # memory or redis
REDIS_URL=redis://...
```

## Request Flow

```
1. Request hits proxy (*.veryfront.com)
2. Proxy extracts project slug from domain
3. Proxy fetches/caches OAuth token
4. Proxy forwards to renderer with headers:
   - x-token: <OAuth token>
   - x-project-slug: <slug>
   - x-environment: preview|production
5. Renderer uses token to fetch from API
6. Renderer performs SSR/RSC
7. Response returned to client
```

## Helm Chart

Deploys both proxy and renderer:

```yaml
# chart/values.yaml
proxy:
  replicaCount: 2
  image: ghcr.io/veryfront/veryfront-proxy

renderer:
  replicaCount: 2
  image: ghcr.io/veryfront/veryfront-renderer
```

## Debugging

### Local Setup
```bash
# 1. Copy config template
cp .env.local.example .env.local

# 2. Fill in OAuth credentials (from 1Password: "Veryfront OAuth Credentials")

# 3. Run:
deno task dev          # Single project mode
deno task dev:multi    # Multi-project (Veryfront staff)
```

### Debug Endpoints
```bash
# Proxy health & stats
curl http://localhost:8080/_proxy/health
curl http://localhost:8080/_proxy/stats

# Renderer context (dev only) - shows token propagation
curl http://codersociety.lvh.me:8080/_vf_debug/context

# Test module serving
curl http://codersociety.lvh.me:8080/_vf_modules/pages/index.js
```

### Debugging Token Issues
If modules return 404 or API calls fail:
1. Check `/_proxy/stats` - is token being fetched?
2. Check `/_vf_debug/context` - did token reach renderer?
3. Compare token lengths to isolate where it's lost

### View Logs
```bash
deno task dev 2>&1 | tee dev.log
```

## Remote Logs

```bash
# Proxy logs
logcli query '{namespace="veryfront-production", container="proxy"} |= "error"' --limit=50

# Renderer logs
logcli query '{namespace="veryfront-production", container="renderer"} |= "error"' --limit=50
```

## Key Files

| File | Purpose |
|------|---------|
| `.env.local.example` | Template for local development config |
| `scripts/dev-proxy.ts` | Launcher for `deno task dev:multi` |
| `proxy/main.ts` | Proxy entry point |
| `proxy/token-manager.ts` | OAuth token lifecycle |
| `src/server/production-server.ts` | Production server |
| `src/server/dev-server.ts` | Development server with HMR |
| `src/cli/main.ts` | CLI entry point |
| `src/rendering/` | SSR/RSC rendering engine |
| `src/routing/` | File-based routing |
| `src/ai/` | AI agent runtime and MCP |
| `veryfront.config.ts` | Framework configuration |
| `chart/values.yaml` | Kubernetes deployment config |
