# Veryfront Renderer

Zero-config React meta-framework with AI-native capabilities. Contains both the **Proxy** (OAuth token management) and **Renderer** (SSR/RSC engine).

## Quick Reference

| Component | Container | Port | Runtime |
|-----------|-----------|------|---------|
| Proxy | `proxy` | 20000 | Deno (Bun) |
| Renderer | `renderer` | 20000 | Deno |

## Tech Stack

- **Runtime**: Deno 2.6+
- **Package Manager**: deno (native)
- **Linter**: deno lint
- **Test Framework**: Deno test
- **Build**: esbuild

## Architecture

```
veryfront-renderer/
├── proxy/                 # OAuth token proxy (separate service)
│   ├── main.ts           # Entry point
│   ├── token-manager.ts  # Token lifecycle
│   ├── cache/            # Memory/Redis caching
│   └── deno.json
├── src/                   # Main framework
│   ├── cli/              # CLI commands (dev, build)
│   ├── server/           # Dev & production servers
│   ├── rendering/        # SSR, RSC, client rendering
│   ├── ai/               # Agent runtime, MCP
│   ├── routing/          # File-based routing
│   └── platform/         # Multi-runtime adapters
├── chart/                 # Helm chart (deploys both)
├── deno.json             # Deno config
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
cd veryfront-renderer
deno task dev              # Start dev server (HMR)
deno task build            # Production build
deno task test             # Run tests
deno task lint             # Lint code
deno task typecheck        # Type check
```

### Proxy (Deno)
```bash
cd veryfront-renderer/proxy
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
      baseUrl: "http://api.lvh.me:4000/api",
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

```bash
# Check proxy health
curl http://localhost:20000/_proxy/health

# Check renderer
curl http://localhost:3001/

# View logs
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
| `proxy/main.ts` | Proxy entry point |
| `proxy/token-manager.ts` | OAuth token lifecycle |
| `src/server/production-server.ts` | Production server |
| `src/server/dev-server.ts` | Development server with HMR |
| `veryfront.config.ts` | Framework configuration |
| `chart/values.yaml` | Kubernetes deployment config |
