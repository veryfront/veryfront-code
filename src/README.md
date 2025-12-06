# Veryfront Source Code Reference

Complete module reference for working with Veryfront's source code.

## Quick Module Overview

| Module               | Export Alias                                                                     | Purpose                                   |
| -------------------- | -------------------------------------------------------------------------------- | ----------------------------------------- |
| **`ai/`**            | `veryfront/ai`                                                                   | AI agent runtime, MCP integration         |
| **`build/`**         | `@veryfront/build`                                                               | Build system, bundler, asset optimization |
| **`cli/`**           | `veryfront/cli`                                                                  | Command-line interface                    |
| **`core/`**          | `@veryfront/types`, `@veryfront/config`, `@veryfront/utils`, `@veryfront/errors` | Foundation types, config, utilities       |
| **`data/`**          | `@veryfront/data`                                                                | Data fetching (getServerData, etc.)       |
| **`html/`**          | `@veryfront/html`                                                                | HTML generation, metadata, hydration      |
| **`middleware/`**    | `@veryfront/middleware`                                                          | Request/response pipeline                 |
| **`module-system/`** | `@veryfront/modules`                                                             | Module loading, resolution, import maps   |
| **`modules/`**       | -                                                                                | Component registry, React loader          |
| **`observability/`** | `@veryfront/observability`                                                       | Metrics, tracing                          |
| **`platform/`**      | `@veryfront/platform`                                                            | Runtime adapters (Deno, Node, Bun, CF)    |
| **`react/`**         | `@veryfront/react`, `@veryfront/components`                                      | React components and hooks                |
| **`rendering/`**     | `@veryfront/rendering`                                                           | SSR/RSC rendering engine                  |
| **`routing/`**       | `@veryfront/routing`                                                             | Route matching, API routes                |
| **`security/`**      | `@veryfront/security`                                                            | Security primitives, validation           |
| **`server/`**        | `@veryfront/server`                                                              | Dev & production servers                  |

---

## Module Details

### `core/` - Foundation Layer

**Purpose**: Shared types, configuration, errors, and utilities used across the framework

**Exports**:

- `@veryfront/types` - TypeScript type definitions
- `@veryfront/config` - Configuration system
- `@veryfront/errors` - Error handling with user-friendly messages
- `@veryfront/utils` - Shared utilities (logging, caching, hashing, paths)

**Dependencies**: None (foundation module)

**Key Directories**:

- `types/` - Framework type definitions
- `config/` - Configuration schema and loader
- `errors/` - Error catalogs and handlers
- `utils/` - Logger, cache, hash, path utilities

---

### `platform/` - Runtime Abstraction

**Purpose**: Multi-platform support (Deno, Node, Bun, Cloudflare Workers)

**Exports**: `@veryfront/platform`

**Dependencies**: `@veryfront/types`

**Key Features**:

- Unified filesystem API across runtimes
- KV store abstraction
- Runtime detection and capabilities
- Platform-specific optimizations

**Directories**:

- `adapters/` - Runtime-specific implementations
- `detection/` - Runtime detection logic
- `types/` - Platform interface types

---

### `security/` - Security Layer

**Purpose**: Security primitives, input validation, and protection

**Exports**: `@veryfront/security`

**Dependencies**: `@veryfront/types`, `@veryfront/utils`

**Key Features**:

- Input validation (JSON, forms, query params) with Zod
- Path traversal protection
- Secure filesystem wrapper
- CORS configuration
- CSP (Content Security Policy) with nonces
- Security headers (HSTS, X-Frame-Options, etc.)

**Directories**:

- `http/` - CORS, CSP, security headers
- `validation/` - Zod schemas and validators

---

### `routing/` - Route Matching

**Purpose**: Route matching, dynamic routes, API routes

**Exports**: `@veryfront/routing`

**Dependencies**: `@veryfront/types`, `@veryfront/security`

**Key Features**:

- App Router style dynamic routing
- API route handlers
- Client-side routing utilities
- Route parameter extraction
- Slug normalization and mapping

**Directories**:

- `api/` - API route handling
- `matchers/` - Route matching algorithms
- `slug-mapper/` - Dynamic route mapping
- `registry/` - Route registry and lookup

---

### `middleware/` - Request Pipeline

**Purpose**: Composable request/response middleware system

**Exports**: `@veryfront/middleware`

**Dependencies**: `@veryfront/types`, `@veryfront/security`

**Key Features**:

- Pipeline composition with `next()`
- Built-in middleware (auth, logging, rate limiting, security)
- Context passing between middleware
- Type-safe middleware interfaces

**Directories**:

- `builtin/` - Framework-provided middleware
- `compose/` - Middleware composition utilities
- `pipeline/` - Pipeline execution engine

---

### `module-system/` - Module Resolution

**Purpose**: Module loading, resolution, and import map management

**Exports**: `@veryfront/modules`

**Dependencies**: `@veryfront/types`, `@veryfront/platform`

**Key Features**:

- Module resolution with import maps
- Component registry for React
- Import transformation (ESM, JSX)
- Dynamic module loading
- Module graph analysis

**Key Files**:

- `module-resolver.ts` - Module resolution logic
- `module-graph.ts` - Dependency graph builder
- `import-map.ts` - Import map management

---

### `modules/` - Component Loading

**Purpose**: Component registry and React module loading

**Dependencies**: `@veryfront/module-system`, `react`

**Key Features**:

- Component registry for MDX
- React component loader
- Module serving in dev mode
- Dynamic imports

**Directories**:

- `component-loader/` - Component discovery and loading
- `react-loader/` - React-specific module loading
- `server/` - Development module server

---

### `data/` - Data Fetching

**Purpose**: Data fetching abstractions for SSR/SSG

**Exports**: `@veryfront/data`

**Dependencies**: `@veryfront/types`

**Key Features**:

- `getServerData()` for SSR page data
- `getStaticPaths()` for SSG
- Data caching layer
- `notFound()` and `redirect()` helpers

**Key Files**:

- `data-fetcher.ts` - Data fetching orchestrator
- `data-fetching-cache.ts` - Cache implementation

---

### `html/` - HTML Generation

**Purpose**: HTML document generation, metadata, hydration

**Exports**: `@veryfront/html`

**Dependencies**: `@veryfront/types`, `@veryfront/module-system`

**Key Features**:

- HTML shell generation
- Metadata extraction and building (Open Graph, Twitter Cards)
- Import map injection
- Hydration script generation
- CSS injection
- `<Head>` component support

**Directories**:

- `html-shell-generator/` - Main HTML document builder
- `hydration-script-builder/` - Client-side hydration
- `metadata/` - Meta tags, SEO, social cards

---

### `react/` - React Integration

**Purpose**: React components and React-specific utilities

**Exports**: `@veryfront/react`, `@veryfront/components`

**Dependencies**: `@veryfront/types`, `react`, `react-dom`

**Key Features**:

- `<Link>` component for client routing
- `<Head>` component for metadata
- `<OptimizedImage>` component with lazy loading
- MDX provider and utilities
- React 17/18/19 compatibility layer
- Hooks (`useRouter`, `useParams`, `usePathname`)

**Directories**:

- `components/` - Framework components
- `compat/` - React version compatibility
- `hooks/` - React hooks

---

### `rendering/` - SSR & RSC Engine

**Purpose**: Server-side rendering, React Server Components, layouts

**Exports**: `@veryfront/rendering`

**Dependencies**: `@veryfront/types`, `@veryfront/utils`, `@veryfront/module-system`, `@veryfront/html`, `react`, `react-dom`

**Key Features**:

- SSR with React 17/18/19 support
- RSC (React Server Components)
- Layout system (nested layouts)
- Streaming rendering
- Render caching
- Virtual module system for dynamic content

**Directories**:

- `ssr/` - Server-side rendering implementation
- `rsc/` - React Server Components
- `layouts/` - Layout discovery and compilation
- `streaming/` - Streaming SSR
- `cache/` - Render result caching

---

### `build/` - Build System

**Purpose**: Production builds, MDX compilation, asset optimization

**Exports**: `@veryfront/build`, `@veryfront/transforms`

**Dependencies**: `@veryfront/types`, `@veryfront/utils`, `@veryfront/platform`, `@veryfront/rendering`

**Key Features**:

- MDX compilation to JSX
- TypeScript → JavaScript transformation
- CSS optimization (Tailwind, UnoCSS)
- Image optimization (WebP, AVIF)
- Code splitting and tree shaking
- Static site generation
- Production bundling

**Directories**:

- `compiler/` - MDX and TypeScript compilation
- `transforms/` - Code transformations (ESM, JSX, MDX)
- `bundler/` - Code splitting and bundling (esbuild)
- `asset-pipeline/` - CSS/image optimization
- `production-build/` - Build orchestration
- `renderer/` - Renderer bundling services

---

### `server/` - HTTP Servers

**Purpose**: Development and production HTTP servers

**Exports**: `@veryfront/server`

**Dependencies**: Most modules (orchestrator role)

**Key Features**:

- Dev server with Hot Module Replacement (HMR)
- Production server with optimizations
- Universal request handler (platform-agnostic)
- Request handlers (static, SSR, API, RSC, modules)
- Error overlay in development
- Bootstrap and initialization

**Directories**:

- `dev-server/` - Development server with HMR
- `production-server.ts` - Production server implementation
- `bootstrap.ts` - Server initialization
- `handlers/` - Request handlers (API, SSR, RSC, static)
- `universal-handler/` - Universal request handler

---

### `cli/` - Command Line Interface

**Purpose**: Command-line tools and project scaffolding

**Exports**: `veryfront/cli`

**Dependencies**: `@veryfront/config`, `@veryfront/platform`, `@veryfront/build`, `@veryfront/server`

**Commands**:

- `dev` - Start development server with HMR
- `build` - Build for production
- `init` - Initialize new project
- `doctor` - Diagnose project issues

**Directories**:

- `commands/` - Individual CLI commands
- `help/` - Help system and documentation
- `templates/` - Project templates (app, blog, docs)

---

### `observability/` - Monitoring

**Purpose**: Metrics collection, distributed tracing, instrumentation

**Exports**: `@veryfront/observability`

**Dependencies**: `@veryfront/types`

**Key Features**:

- Metrics collection (request count, latency, etc.)
- Distributed tracing (OpenTelemetry compatible)
- Auto-instrumentation
- Performance monitoring

---

### `ai/` - AI Integration

**Purpose**: AI agent runtime, MCP server, provider integrations

**Exports**: `veryfront/ai`

**Dependencies**: `@veryfront/types`, `@veryfront/utils`

**Key Features**:

- Agent runtime with tool execution
- MCP (Model Context Protocol) server
- Provider adapters (OpenAI, Anthropic, Google)
- Memory management
- Production features (rate limiting, caching, cost tracking, security)
- React hooks for streaming responses

**Directories**:

- `agent/` - Agent factory and runtime
- `mcp/` - MCP server implementation
- `providers/` - AI provider integrations
- `production/` - Rate limiting, caching, security
- `react/` - React hooks and components

---

## Import Strategy

### Using Import Map Aliases

All internal imports use `@veryfront/*` aliases:

```typescript
// Good - Using import map alias
import { createRenderer } from "@veryfront/rendering";
import type { VeryfrontConfig } from "@veryfront/config";
import { serverLogger } from "@veryfront/utils";

// Bad - Deep relative import
import { createRenderer } from "../../../../rendering/index.ts";
```

### Available Import Aliases

```json
{
  "@veryfront/types": "./src/core/types/index.ts",
  "@veryfront/config": "./src/core/config/index.ts",
  "@veryfront/utils": "./src/core/utils/index.ts",
  "@veryfront/errors": "./src/core/errors/index.ts",
  "@veryfront/platform": "./src/platform/index.ts",
  "@veryfront/security": "./src/security/index.ts",
  "@veryfront/routing": "./src/routing/index.ts",
  "@veryfront/middleware": "./src/middleware/index.ts",
  "@veryfront/modules": "./src/module-system/index.ts",
  "@veryfront/data": "./src/data/index.ts",
  "@veryfront/html": "./src/html/index.ts",
  "@veryfront/react": "./src/react/index.ts",
  "@veryfront/components": "./src/react/components/index.ts",
  "@veryfront/rendering": "./src/rendering/index.ts",
  "@veryfront/build": "./src/build/index.ts",
  "@veryfront/server": "./src/server/index.ts",
  "@veryfront/observability": "./src/observability/index.ts",
  "@veryfront/transforms": "./src/build/transforms/index.ts"
}
```

### Sub-path Imports

Access internal module files using the trailing slash:

```typescript
// Access sub-paths within modules
import { RSCRenderer } from "@veryfront/rendering/rsc/server-renderer/index.ts";
import { serverLogger } from "@veryfront/utils/logger/logger.ts";
```

## Module Dependencies

### Dependency Layers

```
Foundation (0 deps)
└─ core/, platform/

Infrastructure (foundation only)
└─ security/, routing/, middleware/, module-system/

Features (foundation + infrastructure)
└─ data/, html/, react/, rendering/, build/, observability/, ai/

Orchestrators (most modules)
└─ server/, cli/
```

### Dependency Rules

1. Foundation modules have no dependencies
2. Infrastructure depends only on foundation
3. Features depend on foundation + infrastructure
4. Orchestrators can depend on most modules
5. **NO circular dependencies** (enforced by tooling)

## Barrel Exports

Each module exports its public API through `index.ts`:

```typescript
// src/security/index.ts
export { validatePath } from "./path-validation.ts";
export { createSecureFs } from "./secure-fs.ts";
export { createValidatedHandler } from "./input-validation/index.ts";
// Only public API - internal files hidden
```

**Benefits**:

- Clear public API surface
- Internal refactoring without breaking imports
- Enforced module boundaries

## Module Documentation

Each module contains a `README.md` with:

- Purpose and responsibilities
- Key features and APIs
- Usage examples
- Architecture details
- Design decisions

See individual `src/<module>/README.md` files for comprehensive documentation.

## Learn More

- **High-level Architecture**: See `/ARCHITECTURE.md` for design philosophy and core concepts
- **Scripts Reference**: See `/scripts/README.md` for development and testing scripts
- **Navigation Guide**: See `NAVIGATION.md` (this file) for quick module reference
