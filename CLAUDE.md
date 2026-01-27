# Veryfront Renderer

Zero-config React meta-framework with AI-native capabilities. Contains both the **Proxy** (OAuth token management) and **Renderer** (SSR/RSC engine).

## Quick Reference

| Component | Container  | Port  | Runtime |
| --------- | ---------- | ----- | ------- |
| Proxy     | `proxy`    | 20000 | Deno    |
| Renderer  | `renderer` | 20000 | Deno    |

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

## Architecture

Two logical components:
- **Proxy**: Token management, project routing
- **Renderer**: SSR/RSC rendering

### Combined Mode (Local Dev)

```
Client → [Proxy Logic → Renderer] → API
         (single process)
```

- `deno task start` runs both in one process
- Simpler, faster startup
- Auto-discovers local projects

### Split Mode (Production)

```
Client → Proxy → Renderer → API
         ↓
   Token cache (Redis)
```

- Separate containers for security isolation
- OAuth credentials only in proxy

## Development Commands

```bash
# Combined mode (recommended)
deno task start            # Proxy + renderer together
deno task start -p 8080    # Custom port
deno task start --project . # Set default project

# Split mode (separate processes)
deno task proxy            # Proxy only
deno task renderer         # Renderer only

# Other
deno task build            # Production build
deno task test             # Run all tests
deno task lint             # Lint code
deno task typecheck        # Type check
```

## Configuration

### veryfront.config.ts

```typescript
export default {
  fs: {
    type: "veryfront-api",
    veryfront: {
      baseUrl: "http://api.veryfront.me:4000",
      proxyMode: true, // Use proxy headers
      cache: { enabled: true, ttl: 60000 },
    },
  },
  dev: { port: 3001, hmr: true },
};
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
deno task start        # Starts server (auto-discovers local projects)
```

### Debug Endpoints

```bash
# Proxy health & stats
curl http://localhost:8080/_proxy/health
curl http://localhost:8080/_proxy/stats

# Renderer context (dev only) - shows token propagation
curl http://codersociety.veryfront.me:8080/_vf_debug/context

# Test module serving
curl http://codersociety.veryfront.me:8080/_vf_modules/pages/index.js
```

### Debugging Token Issues

If modules return 404 or API calls fail:

1. Check `/_proxy/stats` - is token being fetched?
2. Check `/_vf_debug/context` - did token reach renderer?
3. Compare token lengths to isolate where it's lost

### View Logs

```bash
deno task start 2>&1 | tee server.log
```

## Remote Logs

```bash
# Proxy logs
logcli query '{namespace="veryfront-production", container="proxy"} |= "error"' --limit=50

# Renderer logs
logcli query '{namespace="veryfront-production", container="renderer"} |= "error"' --limit=50
```

## Key Files

| File                      | Purpose                        |
| ------------------------- | ------------------------------ |
| `scripts/server.ts`       | Combined mode launcher         |
| `proxy/main.ts`           | Proxy server (split mode)      |
| `proxy/handler.ts`        | Core proxy logic               |
| `src/cli/main.ts`         | CLI entry point                |
| `src/server/`             | Server implementations         |
| `src/rendering/`          | SSR/RSC rendering engine       |
| `src/routing/`            | File-based routing             |
| `veryfront.config.ts`     | Framework configuration        |
| `chart/values.yaml`       | Kubernetes deployment config   |

## Troubleshooting Production 500 Errors

**Step 1: Always reproduce locally first** (fastest path to root cause):
```bash
# Use production cache - this reproduces cross-environment cache issues
./scripts/debug-production.sh <project-slug>

# Or manually:
VERYFRONT_API_BASE_URL=https://api.veryfront.com PROXY_MODE=1 deno task start
```

**Step 2: Categorize the error**:
| Error Pattern | Category | Fix |
|---------------|----------|-----|
| `Module not found "file://..."` | Cache path mismatch | Clear project cache |
| `Transform failed` | Transform error | Check user code syntax |
| `timeout` / `stuck` | Performance | Restart pods |

**Step 3: Clear cache if needed**:
```bash
# Clear one project's cache
curl -X DELETE "https://api.veryfront.com/internal/cache/project/{projectId}/transforms" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Nuclear option - restart pods
kubectl rollout restart deployment/veryfront-renderer -n veryfront-production
```

See `docs/troubleshooting-500-errors.md` for full guide.

## Releasing Veryfront Code

```bash
deno task release
```

Defaults to patch. Use `minor`, `major`, or `1.0.0` for other versions.

## MCP Skills

| Skill | Purpose |
| ----- | ------- |
| `veryfront` | Build apps - conventions, patterns, scaffolding |
| `flywheel` | Development flywheel - run/observe/fix/verify cycle |

## Development Flywheel

Autonomous development loop with browser automation:

```
┌─────────┐         ┌─────────┐         ┌─────────┐
│   RUN   │────────▶│ OBSERVE │────────▶│   FIX   │
└─────────┘         └─────────┘         └─────────┘
     ▲                                       │
     │              ┌─────────┐              │
     └──────────────│ VERIFY  │◀─────────────┘
                    └─────────┘
```

### Flywheel Tools

| Tool | Purpose |
| ---- | ------- |
| `vf_wait_for_ready` | Poll until server accepts requests |
| `vf_get_flywheel_status` | Aggregated view: server + errors + logs + HMR |
| `vf_trigger_hmr` | Force browser refresh after code changes |
| `vf_get_errors` | Compile, runtime, bundle errors |
| `vf_get_logs` | Server logs with filtering |

### Example Workflow

```bash
# 1. Start server
deno task start &

# 2. Wait for ready
vf_wait_for_ready({ port: 8080 })

# 3. Open browser (Chrome MCP)
tabs_create_mcp() → navigate({ url: "http://localhost:8080" })

# 4. Observe loop
vf_get_flywheel_status()      # Server errors + logs
read_console_messages()        # Browser console
computer({ action: "screenshot" })

# 5. Fix → vf_trigger_hmr → verify
```
