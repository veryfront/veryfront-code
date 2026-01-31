# Veryfront Renderer

Zero-config React meta-framework with AI-native capabilities. SSR/RSC rendering engine with OAuth token proxy.

## Quick Start

```bash
# Install dependencies
deno install

# Start development server
deno task start

# Run tests
deno task test

# Lint and format
deno task lint
deno fmt
```

## Tech Stack

- **Runtime**: Deno 2.6+
- **Framework**: React 19 with SSR/RSC
- **Build**: esbuild
- **Test**: Deno test

## Directory Structure

```
src/
├── cli/           # CLI commands (dev, build, deploy)
├── config/        # Configuration loading and validation
├── modules/       # Module resolution and import maps
├── platform/      # Multi-runtime adapters (Deno/Node/Bun)
├── rendering/     # SSR, RSC, streaming, hydration
├── routing/       # File-based routing, API routes
├── server/        # Dev and production servers
├── transforms/    # ESM transforms, MDX, Tailwind
└── utils/         # Shared utilities

tests/
├── integration/   # Server and E2E tests
├── validation/    # State isolation tests
└── _helpers/      # Test utilities

proxy/             # OAuth token proxy (separate service)
```

## Development Commands

```bash
deno task start              # Start dev server (proxy + renderer)
deno task test               # Run all tests
deno task test:unit          # Unit tests only
deno task test:integration   # Integration tests only
deno task test:e2e:binary    # Compiled binary E2E tests
deno task lint               # Lint code
deno task typecheck          # Type check
deno task verify             # Full CI check (fmt + lint + typecheck + tests)
deno task build:npm          # Build npm distribution
```

## Testing

Tests use isolated temp directories and caches. Key patterns:

```typescript
// Use withTestContext for automatic cleanup
await withTestContext("my-test", async (context) => {
  const server = await context.createDevServer({ port });
  // Test assertions...
});
```

Run specific test files:
```bash
deno test --allow-all tests/integration/full-lifecycle.test.ts
```

## Architecture

### Request Flow

```
Request → Proxy → Renderer → Response
            ↓
      Token Cache (Redis/Memory)
            ↓
      Veryfront API (files, config)
```

### Key Modules

| Module | Purpose |
|--------|---------|
| `src/rendering/orchestrator/` | SSR pipeline coordination |
| `src/transforms/pipeline/` | ESM transform stages |
| `src/modules/server/` | Module serving and caching |
| `src/routing/` | File-based routing |

## Configuration

Projects use `veryfront.config.ts`:

```typescript
export default {
  fs: { type: "local" },  // or "veryfront-api" for cloud
  dev: { port: 3001, hmr: true },
};
```

## Environment Variables

```bash
# Development
PROXY_MODE=1                    # Enable proxy mode
VERYFRONT_API_TOKEN=vf_...      # API token
VERYFRONT_PROJECT_SLUG=my-proj  # Project slug

# Production
PRODUCTION_MODE=1               # Use published releases
REDIS_URL=redis://...           # Distributed cache
```

## Code Style

- TypeScript strict mode
- No explicit `any` - use `unknown` and narrow
- Prefer `async/await` over callbacks
- Use `#veryfront/` import aliases for internal modules
- Tests should be self-contained with cleanup

## CI/CD

Tests run on every PR:
- `ci (format, lint, typecheck)` - Code quality
- `tests (unit, integration)` - Automated tests
- `tests (binary e2e)` - Compiled binary validation

Releases triggered by tags (`v*`) build binaries for all platforms and publish to npm.

## Debugging

```bash
# View server logs
deno task start 2>&1 | tee server.log

# Debug specific test
deno test --allow-all --filter "test name" tests/path/to/test.ts

# Check module resolution
curl http://localhost:3001/_vf_modules/pages/index.js
```

## Common Issues

| Issue | Solution |
|-------|----------|
| `Module not found "file://..."` | Clear `.cache/` directory |
| `Invalid hook call` | Check React version consistency |
| Test timeout | Increase timeout or check for hanging promises |
| Port in use | Use `--port` flag or check for zombie processes |
