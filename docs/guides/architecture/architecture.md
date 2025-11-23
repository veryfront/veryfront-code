# Veryfront Architecture

Modern React meta-framework for Deno with SSR, SSG, ISR, JIT, and RSC support.

## Overview

Veryfront is a **single-package React meta-framework** with clean, modular architecture designed for:

1. **Multi-Runtime Support** - Deno, Node.js, Bun, and Cloudflare Workers
2. **Multiple Rendering Modes** - SSR, SSG, ISR, JIT, and RSC (experimental)
3. **Developer Experience** - HMR, Fast Refresh, zero-config MDX
4. **Performance** - Code splitting, image optimization, intelligent caching
5. **Flexibility** - App Router and Pages Router support

### Key Features

- **Routing**: App Router (Next.js-style) + Pages Router (file-based)
- **Rendering**: SSR, SSG, ISR, JIT (unique!), RSC (experimental)
- **Content**: Zero-config MDX with frontmatter support
- **Platform**: Works on Deno, Node.js, Bun, Cloudflare Workers
- **Build**: Fast builds with esbuild, asset optimization

## Architecture Principles

### 1. Clean Separation of Concerns

```
src/
├── Public API       → What users import (index.ts, server/, components/)
├── Framework Core   → Rendering, routing, data, build
├── Infrastructure   → Platform, security, observability, core
└── Developer Tools  → CLI, dev server, HMR
```

### 2. Modular Design

Each directory has a **single responsibility**:
- `rendering/` - Page rendering logic only
- `routing/` - URL matching and navigation only
- `data/` - Data fetching only
- etc.

**See [src/NAVIGATION.md](../../src/NAVIGATION.md) for module navigation guide.**

### 3. Platform Abstraction

The `platform/` layer provides unified APIs across runtimes:

```typescript
// Works on Deno, Node.js, Bun, Cloudflare Workers
import { fs, path, runtime } from "@veryfront/platform";

const content = await fs.readFile("page.tsx");
```

### 4. Import Conventions

**Internal imports** use `@veryfront` aliases:
```typescript
import { logger } from "@veryfront/utils";
import { DataFetcher } from "@veryfront/data";
import { createRenderer } from "@veryfront/rendering";
```

**User-facing API** uses clean subpath exports:
```typescript
import { Link, Head, defineConfig } from "veryfront";
import { startUniversalServer } from "veryfront/server";
```

## Directory Structure

### Module Organization (15 Modules)

```
src/
├──  PUBLIC API (what users import)
│   ├── index.ts              → veryfront
│   ├── server/               → veryfront/server
│   ├── middleware/           → veryfront/middleware
│   ├── react/components/     → veryfront/components
│   ├── data/                 → veryfront/data
│   └── core/config/          → veryfront/config
│
├──  FRAMEWORK CORE
│   ├── rendering/            → SSR, RSC, streaming, layouts
│   ├── routing/              → Route matching, API routes
│   ├── build/                → Bundling, compilation, SSG
│   ├── html/                 → HTML generation, hydration
│   ├── modules/              → Module loading, import maps
│   └── react/                → React integration, components
│
├──  INFRASTRUCTURE
│   ├── platform/             → Runtime adapters (Deno/Node/Bun/CF)
│   ├── security/             → CORS, CSP, input validation
│   ├── observability/        → Metrics, tracing
│   ├── core/                 → Shared (config, errors, types, utils)
│   └── types/                → Entity type definitions
│
└──  DEVELOPER TOOLS
    ├── cli/                  → CLI commands (dev, build)
    └── server/               → Dev server, HMR, production server
```

### Key Modules

**Public API:**
- `index.ts` - Main export (components, data helpers, config)
- `server/` - Server APIs (startUniversalServer, dev server)
- `middleware/` - Middleware system
- `react/components/` - Link, Head, MDXProvider, OptimizedImage
- `data/` - Data fetching utilities
- `core/config/` - Configuration (defineConfig)

**Framework Core:**
- `rendering/` - SSR/SSG/RSC engine, layouts, caching
- `routing/` - Route matching, API routes, dynamic routes
- `build/` - Production builds, bundling, MDX compilation
- `html/` - HTML generation, hydration scripts, meta tags
- `modules/` - Module loading, import maps, component registry
- `react/` - React integration, version compatibility

**Infrastructure:**
- `platform/` - Deno/Node/Bun/Cloudflare adapters
- `security/` - CORS, CSP, input validation
- `observability/` - Metrics and tracing
- `core/` - Config, errors, types, utilities

**Developer Tools:**
- `cli/` - Commands (dev, build, preview)
- `server/` - Dev server with HMR, production server

**Each module has a README** - See `src/<module>/README.md` for details.

## Dependency Flow

```
┌─────────────────────────────────────────┐
│         Application Layer               │
│  (User's pages/, components/, api/)     │
└─────────────────────────────────────────┘
              ↓ uses
┌─────────────────────────────────────────┐
│         Public API Layer                │
│  (index.ts, server/, middleware/)       │
└─────────────────────────────────────────┘
              ↓ uses
┌─────────────────────────────────────────┐
│       Framework Core Layer              │
│  (rendering/, routing/, build/)         │
└─────────────────────────────────────────┘
              ↓ uses
┌─────────────────────────────────────────┐
│      Infrastructure Layer               │
│  (platform/, security/, core/)          │
└─────────────────────────────────────────┘
              ↓ uses
┌─────────────────────────────────────────┐
│         Runtime Layer                   │
│  (Deno / Node.js / Bun / CF Workers)   │
└─────────────────────────────────────────┘
```

### Import Rules

 **Allowed:**
- Framework Core → Infrastructure
- Public API → Framework Core
- Infrastructure → Runtime APIs
- Any → core/utils (shared utilities)

 **Not Allowed:**
- Infrastructure → Framework Core (circular dependency)
- Deep imports bypassing module boundaries

## Rendering Modes

### 1. Server-Side Rendering (SSR)

Real-time rendering on each request.

**Flow:**
```
Request → Route Match → Data Fetch → React Render → HTML → Response
```

**Key modules:** `rendering/ssr/`, `react/compat/`, `html/`

### 2. Static Site Generation (SSG)

Pre-render at build time.

**Build:**
```
Build → Find Pages → getStaticPaths → Render Each → Write HTML
```

**Key modules:** `build/production/`, `data/`, `build/asset-pipeline/`

### 3. Incremental Static Regeneration (ISR)

On-demand regeneration with caching.

**First request:**
```
Request → Check Cache → Miss → Generate → Store → Response
```

**Subsequent:**
```
Request → Serve Cached → (Background: Check Revalidate → Regenerate)
```

**Key modules:** `rendering/cache/`, `data/`

### 4. JIT (Just-In-Time) Rendering - Unique!

Hybrid approach for massive sites (100,000+ pages).

**Build:**
```
Build → Identify Critical Pages → Pre-render → Store Manifest
```

**Runtime:**
```
Request → Check Manifest → Generate (if new) → Cache → Response
```

**Benefits:**
- Handle large sites efficiently
- Only build critical pages upfront
- Generate others on first request
- Cache for subsequent requests

**Key modules:** `build/production/`, `rendering/cache/`

### 5. React Server Components (RSC) - Experimental

Zero-JS pages with server components.

**Flow:**
```
Request → Load RSC Tree → Render Server Components → Serialize →
Client Loads → Hydrate Client Components → Interactive
```

**Key modules:** `rendering/rsc/`, `server/handlers/`

## Request Flow

### Development Mode (with HMR)

```
1. Request arrives
   ↓
2. server/dev-server/
   ↓
3. Route matching (routing/matchers/)
   ↓
4. API route? → routing/api/ → Response
   Page route? → Continue
   ↓
5. Data fetching (data/)
   ↓
6. SSR rendering (rendering/ssr/)
   ↓
7. HTML generation (html/)
   ↓
8. Inject HMR client script
   ↓
9. Response with HTML + HMR WebSocket
```

### Production Mode

```
1. Request arrives
   ↓
2. server/production-server.ts
   ↓
3. Middleware pipeline (middleware/)
   ↓
4. Static assets? → Serve from dist/
   API route? → routing/api/ → Response
   ↓
5. Check render cache (rendering/cache/)
   ↓
6. Hit? → Return cached HTML
   Miss? → Continue
   ↓
7. Data fetching (data/)
   ↓
8. SSR rendering (rendering/ssr/)
   ↓
9. HTML generation (html/)
   ↓
10. Store in cache (if cacheable)
    ↓
11. Response with HTML
```

## Build Process

### Development Build

```
1. cli/commands/dev.ts
   ↓
2. Start dev server (server/dev-server/)
   ↓
3. Watch files for changes
   ↓
4. On change:
   - Clear module cache
   - Rebuild affected modules
   - Send HMR update via WebSocket
   ↓
5. Browser receives update
   - Hot reload changed modules
   - Preserve React state (Fast Refresh)
```

### Production Build

```
1. cli/commands/build/
   ↓
2. Load config (core/config/)
   ↓
3. Analyze routes (routing/)
   ↓
4. For each page:
   a. Fetch data (getStaticData/getStaticPaths)
   b. Render to HTML (rendering/ssr/)
   c. Extract assets
   ↓
5. Bundle client code (build/bundler/)
   - Code splitting by route
   - Tree shaking
   - Minification
   ↓
6. Optimize assets (build/asset-pipeline/)
   - Images → WebP/AVIF
   - CSS → PostCSS/Tailwind
   - Compression
   ↓
7. Generate manifests
   - Build manifest
   - Route manifest
   - Asset manifest
   ↓
8. Write to dist/
   - Static pages
   - Client bundles
   - Assets
```

## Testing Strategy

### Unit Tests

**Co-located with source:**
```
src/rendering/ssr/ssr-renderer.test.ts
src/routing/matchers/route-matcher.test.ts
```

**Coverage target:** 80%+

### Integration Tests

**Centralized:**
```
tests/integration/
├── render/        → Full rendering pipeline
├── server/        → Server functionality
├── data/          → Data fetching
└── routing/       → Routing logic
```

**Run:** `deno task test:integration`

### Test Isolation

Tests run in **parallel batches** for speed:

```bash
deno task test              # All tests
deno task test:unit         # Unit tests only
deno task test:integration  # Integration tests only
```

## Design Decisions

### Why Single Package?

**Decision:** Single `veryfront` package instead of monorepo.

**Rationale:**
1. **Simpler for users** - One import source
2. **Faster iteration** - No multi-package coordination
3. **Easier debugging** - All code in one place
4. **Better tree-shaking** - Bundlers see the whole graph
5. **Industry standard** - Next.js, Remix, SvelteKit all use single package

### Why @veryfront Aliases?

**Decision:** Use `@veryfront/` import aliases internally.

**Rationale:**
1. **Clear module boundaries** - Easy to see dependencies
2. **Refactoring safety** - Can move files without breaking imports
3. **Consistent style** - All internal imports look the same
4. **IDE support** - Better autocomplete and navigation

### Why Platform Abstraction?

**Decision:** Abstract runtime APIs into `platform/`.

**Rationale:**
1. **Multi-runtime support** - Works on Deno, Node.js, Bun, CF Workers
2. **Easier testing** - Mock platform layer
3. **Future-proof** - Add new runtimes without changing core
4. **Consistent APIs** - Same interface regardless of runtime

### Why JIT Rendering?

**Decision:** Add JIT rendering mode (unique to Veryfront!).

**Rationale:**
1. **Handle massive sites** - 100,000+ pages efficiently
2. **Fast builds** - Only pre-render critical pages
3. **On-demand generation** - Generate others on first request
4. **Smart caching** - Cache generated pages

**Use cases:** Large blogs, documentation sites, e-commerce catalogs

## Architecture Benefits

### 1. Multi-Runtime Support
Single codebase works on Deno, Node.js, Bun, Cloudflare Workers via platform abstraction.

### 2. Flexible Rendering
Choose the right mode for each use case:
- SSR for dynamic pages
- SSG for static content
- ISR for occasional updates
- JIT for massive sites
- RSC for zero JS pages (experimental)

### 3. Developer Experience
- HMR with Fast Refresh
- Zero-config setup
- TypeScript by default
- Clear error messages
- Fast feedback loops

### 4. Performance
- Automatic code splitting
- Intelligent caching
- Image optimization
- Streaming SSR
- Lazy loading

### 5. Maintainability
- Clear module boundaries
- Single responsibility per module
- Comprehensive documentation (15/15 modules)
- Easy to find code (see `src/NAVIGATION.md`)
- Good test coverage

## Related Documentation

- **Getting Started**: See [Quick Start Guide](../quick-start.md)
- **Introduction**: See [Introduction](../introduction.md)
- **Code Navigation**: See [src/NAVIGATION.md](../../src/NAVIGATION.md)
- **Contributing**: See [Contributing Guide](../community/contributing.md)
- **Module Docs**: See `../../src/<module>/README.md` for each module

All 15 modules have comprehensive READMEs with:
- Purpose and scope
- Architecture diagrams
- Key exports
- Usage examples
- Troubleshooting guides

---

**Version:** 0.1.0 (pre-release)
**Last Updated:** 2025-11-09
**License:** MIT
