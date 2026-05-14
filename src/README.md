# Veryfront

## Module Overview

### Core Infrastructure

| Module          | Export Alias          | Purpose                                             |
| --------------- | --------------------- | --------------------------------------------------- |
| **`config/`**   | `#veryfront/config`   | Configuration schema and loader                     |
| **`types/`**    | `#veryfront/types`    | TypeScript type definitions                         |
| **`utils/`**    | `#veryfront/utils`    | Shared utilities (logging, caching, hashing, paths) |
| **`errors/`**   | `#veryfront/errors`   | Error handling with user-friendly messages          |
| **`platform/`** | `#veryfront/platform` | Runtime adapters (Deno, Node, Bun, Cloudflare)      |

### Request Handling

| Module            | Export Alias            | Purpose                                         |
| ----------------- | ----------------------- | ----------------------------------------------- |
| **`server/`**     | `#veryfront/server`     | Dev server (HMR) + production server + handlers |
| **`proxy/`**      | -                       | Reverse proxy for multi-project routing         |
| **`routing/`**    | `#veryfront/routing`    | Route matching, API routes, dynamic routes      |
| **`middleware/`** | `#veryfront/middleware` | Composable request/response pipeline            |
| **`security/`**   | `#veryfront/security`   | Input validation, CORS, CSP, rate limiting      |

### Rendering Pipeline

| Module           | Export Alias                                | Purpose                                    |
| ---------------- | ------------------------------------------- | ------------------------------------------ |
| **`rendering/`** | `#veryfront/rendering`                      | SSR/RSC engine, layouts, streaming         |
| **`html/`**      | `#veryfront/html`                           | HTML shell generation, metadata, hydration |
| **`react/`**     | `#veryfront/react`, `#veryfront/components` | Framework components and hooks             |
| **`data/`**      | `#veryfront/data`                           | Data fetching (`getServerData`, etc.)      |

### Module System

| Module            | Export Alias            | Purpose                                          |
| ----------------- | ----------------------- | ------------------------------------------------ |
| **`modules/`**    | `#veryfront/modules`    | Component registry, React loader, module server  |
| **`transforms/`** | `#veryfront/transforms` | Code transformation (ESM, MDX, import rewriting) |
| **`cache/`**      | -                       | Multi-layer caching (memory, Redis, file)        |
| **`bundler/`**    | -                       | esbuild integration for bundling                 |

### Build System

| Module       | Export Alias       | Purpose                                         |
| ------------ | ------------------ | ----------------------------------------------- |
| **`build/`** | `#veryfront/build` | Production builds, SSG, asset optimization      |
| **`cli/`**   | `veryfront/cli`    | Command-line interface (`dev`, `build`, `init`) |

### Agent System

| Module           | Export Alias           | Purpose                                               |
| ---------------- | ---------------------- | ----------------------------------------------------- |
| **`agent/`**     | `veryfront/agent`      | AI agent runtime, AG-UI streaming, hosted execution   |
| **`tool/`**      | `veryfront/tool`       | Tool definitions and registry                         |
| **`workflow/`**  | `veryfront/workflow`   | Durable DAG-based workflow engine with crash recovery |
| **`skill/`**     | `#veryfront/skill`     | Agent skills (SKILL.md) and prompt augmentation       |
| **`chat/`**      | `veryfront/chat`       | Chat UI components, AG-UI protocol, streaming hooks   |
| **`prompt/`**    | `veryfront/prompt`     | Prompt templates and registry                         |
| **`resource/`**  | `veryfront/resource`   | Resource definitions (MCP protocol)                   |
| **`mcp/`**       | `veryfront/mcp`        | Model Context Protocol server (SSE, sessions)         |
| **`provider/`**  | `veryfront/provider`   | AI model providers (OpenAI, Anthropic, Google)        |
| **`embedding/`** | `veryfront/embedding`  | Vector embeddings for semantic search                 |
| **`discovery/`** | `#veryfront/discovery` | Auto-discovery of tools, agents, workflows            |

### Services & Infrastructure

| Module                 | Export Alias             | Purpose                                           |
| ---------------------- | ------------------------ | ------------------------------------------------- |
| **`jobs/`**            | `veryfront/jobs`         | Background jobs client (one-off and cron)         |
| **`task/`**            | `#veryfront/task`        | Task definitions and runner                       |
| **`sandbox/`**         | `veryfront/sandbox`      | Ephemeral compute environments                    |
| **`channels/`**        | `#veryfront/channels`    | Control-plane agent routing                       |
| **`integrations/`**    | `veryfront/integrations` | Third-party connector metadata and remote tools   |
| **`internal-agents/`** | -                        | Hosted agent runtime (AG-UI, sessions, auth)      |
| **`schemas/`**         | `#veryfront/schemas`     | Shared Zod validation schemas and `defineSchema`  |
| **`registry/`**        | -                        | Project-scoped multi-tenant registry manager      |
| **`fs/`**              | `veryfront/fs`           | Cross-runtime filesystem and path utilities       |
| **`markdown/`**        | `veryfront/markdown`     | Markdown React component with syntax highlighting |
| **`mdx/`**             | `veryfront/mdx`          | MDXProvider for component overrides               |
| **`extensions/`**      | `#veryfront/extensions`  | Extension contracts, loader, and orchestration    |

### Supporting Modules

| Module               | Purpose                                      |
| -------------------- | -------------------------------------------- |
| **`observability/`** | Metrics, distributed tracing (OpenTelemetry) |
| **`oauth/`**         | OAuth authentication flows                   |
| **`studio/`**        | Studio integration (editor UI)               |
| **`testing/`**       | Test utilities and fixtures                  |
| **`repositories/`**  | Data repositories abstraction                |
| **`runtime/`**       | Cross-runtime bridge and detection           |
| **`issues/`**        | Issue tracking integration                   |
| **`client/`**        | Client-side utilities                        |

---

## Module Details

### `config/` - Configuration

**Purpose**: Configuration schema, loading, and validation

**Exports**: `#veryfront/config`

**Key Features**:

- `veryfront.config.ts` schema and types
- Environment-aware configuration
- Default configuration merging

---

### `types/` - Type Definitions

**Purpose**: Shared TypeScript type definitions

**Exports**: `#veryfront/types`

**Key Features**:

- Framework type definitions
- Request/response types
- Component and page types

---

### `utils/` - Utilities

**Purpose**: Shared utilities used across the framework

**Exports**: `#veryfront/utils`

**Key Features**:

- Logger with debug/info/warn/error levels
- LRU cache implementation
- Content hashing
- Path utilities
- Constants

---

### `errors/` - Error Handling

**Purpose**: Structured error handling with user-friendly messages

**Exports**: `#veryfront/errors`

**Key Features**:

- Error catalog with codes
- User-friendly error messages
- Stack trace formatting
- Error recovery suggestions

---

### `platform/` - Runtime Abstraction

**Purpose**: Multi-platform support (Deno, Node, Bun, Cloudflare Workers)

**Exports**: `#veryfront/platform`

**Key Features**:

- Unified filesystem API across runtimes
- KV store abstraction
- Veryfront API client
- Runtime detection and capabilities

**Directories**:

- `adapters/` - Runtime-specific implementations
  - `fs/` - Filesystem adapters (local, veryfront API, GitHub)
  - `veryfront-api-client/` - API client with retry handling
  - `token/` - Token management

---

### `server/` - HTTP Servers

**Purpose**: Development and production HTTP servers

**Exports**: `#veryfront/server`

**Key Features**:

- Dev server with Hot Module Replacement (HMR)
- Production server with optimizations
- Runtime request handler (platform-agnostic)
- Request handlers (static, SSR, API, RSC, modules, CSS)
- Error overlay in development

**Directories**:

- `dev-server/` - Development server with HMR
- `handlers/` - Request handlers by type
  - `request/` - SSR, module, CSS, snippet handlers
  - `preview/` - Preview mode HMR
  - `monitoring/` - Health and metrics endpoints
  - `dev/` - Development-only handlers
- `runtime-handler/` - Platform-agnostic request handling
- `services/` - Static file serving

---

### `proxy/` - Reverse Proxy

**Purpose**: Multi-project routing and request proxying

**Key Features**:

- Route requests to correct project
- Domain-based project resolution
- API proxying to Veryfront backend
- WebSocket proxying for HMR

---

### `routing/` - Route Matching

**Purpose**: Route matching, dynamic routes, API routes

**Exports**: `#veryfront/routing`

**Key Features**:

- App Router style dynamic routing (`[slug]`, `[...catchAll]`)
- API route handlers (Pages Router and App Router patterns)
- Route parameter extraction
- Slug normalization and mapping

**Directories**:

- `api/` - API route handling
- `dynamic-router/` - Dynamic route matching

---

### `middleware/` - Request Pipeline

**Purpose**: Composable request/response middleware system

**Exports**: `#veryfront/middleware`

**Key Features**:

- Pipeline composition with `next()`
- Built-in middleware (auth, logging, rate limiting, security)
- Context passing between middleware

**Directories**:

- `builtin/` - Framework-provided middleware

---

### `security/` - Security Layer

**Purpose**: Security primitives, input validation, and protection

**Exports**: `#veryfront/security`

**Key Features**:

- Input validation with Zod
- Path traversal protection
- CORS configuration
- CSP (Content Security Policy)
- Rate limiting
- Sandbox for untrusted code

**Directories**:

- `rate-limit/` - Rate limiting implementation
- `sandbox/` - Sandboxed execution

---

### `rendering/` - SSR & RSC Engine

**Purpose**: Server-side rendering, React Server Components, layouts

**Exports**: `#veryfront/rendering`

**Key Features**:

- SSR with React 17/18/19 support
- RSC (React Server Components)
- Layout system (nested layouts)
- Streaming rendering
- Render caching
- Context management

**Directories**:

- `ssr/` - Server-side rendering implementation
- `rsc/` - React Server Components
- `layouts/` - Layout discovery and compilation
- `cache/` - Render result caching
- `context/` - Request context management
- `orchestrator/` - Rendering orchestration
- `shared/` - Shared rendering utilities

---

### `html/` - HTML Generation

**Purpose**: HTML document generation, metadata, hydration

**Exports**: `#veryfront/html`

**Key Features**:

- HTML shell generation
- Metadata extraction (Open Graph, Twitter Cards)
- Import map injection
- Hydration script generation
- CSS injection
- `<Head>` component support

**Directories**:

- `hydration-script-builder/` - Client-side hydration scripts
- `styles-builder/` - CSS/Tailwind compilation

---

### `react/` - React Integration

**Purpose**: React components and React-specific utilities

**Exports**: `#veryfront/react`, `#veryfront/components`

**Key Features**:

- `<Head>` component for metadata
- `<Link>` component for client routing
- `<Image>` component with optimization
- MDX provider and utilities
- React 17/18/19 compatibility layer
- Hooks (`useRouter`, `useParams`, `usePathname`)

**Directories**:

- `components/` - Framework components
  - `chat/` - Chat-related components
- `compat/` - React version compatibility
- `primitives/` - Low-level React primitives

---

### `data/` - Data Fetching

**Purpose**: Data fetching abstractions for SSR/SSG

**Exports**: `#veryfront/data`

**Key Features**:

- `getServerData()` for SSR page data
- `getStaticPaths()` for SSG
- Data caching layer
- `notFound()` and `redirect()` helpers

---

### `modules/` - Module Loading

**Purpose**: Component registry and module serving at runtime

**Exports**: `#veryfront/modules`

**Key Features**:

- Component registry for React
- React component loader for SSR
- Module server (serves `/_vf_modules/*`)
- Import map management
- Dynamic module loading

**Directories**:

- `react-loader/` - React-specific module loading
  - `ssr-module-loader/` - SSR module loading with caching
- `import-map/` - Import map management
- `server/` - Development module server

---

### `transforms/` - Code Transformation

**Purpose**: Code transformation for ESM, MDX, and imports

**Exports**: `#veryfront/transforms`

**Key Features**:

- ESM transformation (TypeScript/JSX to browser-compatible JS)
- MDX compilation to React components
- Import rewriting (strategies for different import types)
- Transform pipeline with plugin stages

**Directories**:

- `esm/` - ESM transformation engine
- `mdx/` - MDX compilation system
- `import-rewriter/` - Import specifier rewriting
  - `strategies/` - Per-import-type strategies (React, npm, veryfront, cross-project)
- `pipeline/` - Transform pipeline stages

See [`transforms/import-rewriter/README.md`](./transforms/import-rewriter/README.md) for module resolution documentation.

---

### `cache/` - Caching System

**Purpose**: Multi-layer caching for performance

**Key Features**:

- Memory cache (LRU)
- Redis cache integration
- File-based cache
- Cache invalidation
- Tag-based cache grouping

---

### `bundler/` - Bundling

**Purpose**: esbuild integration for code bundling

**Key Features**:

- esbuild wrapper
- Code splitting
- Tree shaking
- Bundle optimization

---

### `build/` - Build System

**Purpose**: Production builds, MDX compilation, asset optimization

**Exports**: `#veryfront/build`

**Key Features**:

- MDX compilation to JSX
- TypeScript to JavaScript transformation
- CSS optimization (Tailwind)
- Image optimization
- Static site generation
- Production bundling

**Directories**:

- `production-build/` - Build orchestration

---

### `cli/` - Command Line Interface

**Purpose**: Command-line tools and project scaffolding

**Exports**: `veryfront/cli`

**Commands**:

- `dev` - Start development server with HMR
- `build` - Build for production
- `init` - Initialize new project
- `doctor` - Diagnose project issues

**Directories**:

- `commands/` - Individual CLI commands
- `app/` - CLI application setup
- `auth/` - Authentication commands
- `mcp/` - MCP server commands
- `templates/` - Project templates and integrations

---

### Agent Modules

#### `agent/` - Agent Runtime

**Exports**: `veryfront/agent`

- Agent factory and runtime execution
- AG-UI protocol streaming (browser response encoding, chunk bridging, event normalization)
- Hosted chat preparation, live steering refresh, prepared execution streaming, and detached run finalization
- Veryfront Cloud agent service (bootstrap, routes, runtime system messages, gateway model resolver)
- Child-run orchestration (fork execution, artifact support, tool selection, stream watchdog)
- Memory management (conversation, buffer, summary)
- Agent composition (`agentAsTool`)
- React hooks (`useChat`, `useAgent`)
- Project steering (mutation, refresh, adapter)
- Provider-native tool inventory and transport

#### `tool/` - Tool System

**Exports**: `veryfront/tool`

- Tool factory and registry
- Tool execution engine
- Zod schema to JSON schema conversion
- Project-scoped multi-tenant tool isolation

#### `workflow/` - Workflow Engine

**Exports**: `veryfront/workflow`

- Durable DAG-based workflow execution with Redis checkpoints
- Step, parallel, and branch primitives
- Crash recovery via heartbeat and stalled detection
- Pluggable job executors (K8sJobExecutor, ProcessJobExecutor)
- Multi-tenant isolation with context capture/restore
- Claude Code workflow integration
- Workflow DSL, discovery, and runtime backends

#### `skill/` - Agent Skills

**Exports**: `#veryfront/skill`

- SKILL.md file parsing and registry
- Prompt augmentation for agents
- Tool allowlist enforcement
- Script executor with path safety
- Skill metadata and content loading

#### `chat/` - Chat System

**Exports**: `veryfront/chat`

- Chat UI components and streaming hooks
- AG-UI SSE parser and protocol types
- Conversation management and message preparation
- Provider error handling and stream watchdog
- Hosted UI chunk mapping for Veryfront Cloud

#### `prompt/` - Prompt Templates

**Exports**: `veryfront/prompt`

- Prompt factory and registry
- Template rendering

#### `resource/` - Resources

**Exports**: `veryfront/resource`

- Resource factory and registry
- MCP resource protocol

#### `mcp/` - MCP Server

**Exports**: `veryfront/mcp`

- Model Context Protocol server (SSE and HTTP transports)
- Session management and task store
- Elicitation support for interactive tool inputs
- Aggregates tools, prompts, resources from project discovery

#### `provider/` - Model Providers

**Exports**: `veryfront/provider`

- Provider adapters (OpenAI, Anthropic, Google)
- Provider initialization and management via extension contracts
- LLM provider registry with model routing (`anthropic/*`, `openai/*`, `google/*`)

#### `embedding/` - Vector Embeddings

**Exports**: `veryfront/embedding`

- Vector embedding generation
- Semantic search support

#### `discovery/` - Auto-Discovery

**Exports**: `#veryfront/discovery`

- Automatic file-system discovery of tools, agents, workflows, prompts, resources
- Project discovery configuration and handler dispatch
- Import rewriting and transpilation for discovered files
- Provider config validation
- Skill discovery from project directories

#### `jobs/` - Background Jobs

**Exports**: `veryfront/jobs`

- `VeryfrontJobsClient` for one-off and cron job management
- Job target discovery and execution
- Runtime environment helpers
- Event and log streaming

#### `task/` - Task Definitions

**Exports**: `#veryfront/task`

- File-based task discovery from project directories
- Task runner with typed context
- Integration with the jobs system for background execution

#### `sandbox/` - Ephemeral Compute

**Exports**: `veryfront/sandbox`

- `Sandbox` class for creating isolated execution environments
- Command execution with streaming output
- Shell tools and hosted tool integration
- Agent service sandbox aliases

#### `channels/` - Control Plane

**Exports**: `#veryfront/channels`

- Control-plane routes for agent listing and streaming
- EdDSA-signed request validation
- Agent invocation dispatch

#### `integrations/` - Connectors

**Exports**: `veryfront/integrations`

- Integration metadata and SVG icons for all connectors
- Remote tool definitions for third-party services
- OAuth configuration schemas

#### `internal-agents/` - Hosted Agent Runtime

- AG-UI SSE streaming for hosted agent sessions
- Control-plane authentication (EdDSA verification)
- Session management and runtime ownership
- Request body parsing and schema validation

#### `schemas/` - Shared Validation

**Exports**: `#veryfront/schemas`

- `defineSchema` DSL backed by `@veryfront/ext-schema-zod`
- Common cross-module validators (email, URL, pagination)
- Primitive validators (non-empty string, positive int)
- Schema-first type inference pattern

#### `registry/` - Multi-Tenant Registry

- Project-scoped registry manager for multi-tenant isolation
- Scoped facade for tools, prompts, workflows, agents, resources

#### `fs/` - Filesystem Utilities

**Exports**: `veryfront/fs`

- Cross-runtime file operations (read, write, exists, mkdir)
- Path utilities (join, resolve, dirname, basename, extname)
- Working directory management

#### `markdown/` - Markdown Rendering

**Exports**: `veryfront/markdown`

- `<Markdown>` React component with syntax highlighting
- Code block rendering with language detection

#### `mdx/` - MDX Provider

**Exports**: `veryfront/mdx`

- `<MDXProvider>` for component overrides in `.mdx` pages
- `useMDXComponents` hook

#### `extensions/` - Extension Bridge

**Exports**: `#veryfront/extensions`

- Extension contract definitions (AuthProvider, Bundler, CSSProcessor, etc.)
- Extension factory loader and lifecycle orchestration
- Capability validation and discovery
- LLM provider registry bridge
- Schema validator bridge
- Database client bridge

---

### `observability/` - Monitoring

**Purpose**: Metrics collection, distributed tracing

**Exports**: `#veryfront/observability`

**Key Features**:

- Metrics collection (request count, latency)
- Distributed tracing (OpenTelemetry compatible)
- Performance monitoring

**Directories**:

- `tracing/` - Distributed tracing

---

### Supporting Modules

#### `oauth/` - OAuth

- OAuth authentication flows
- Token management

#### `studio/` - Studio Integration

- Editor UI integration
- Studio bridge communication

#### `testing/` - Test Utilities

- Test fixtures
- Mock utilities
- Test helpers

#### `repositories/` - Data Repositories

- Repository pattern implementation
- Data access abstraction

#### `issues/` - Issue Tracking

- Issue management utilities

#### `runtime/` - Runtime Bridge

- Cross-runtime compatibility layer
- Runtime detection and capability abstraction

#### `client/` - Client Utilities

- Client-side utilities
- Browser-specific helpers

---

## Module Resolution

Veryfront uses a multi-strategy import resolution system:

| Import Pattern | Example             | Resolution                      |
| -------------- | ------------------- | ------------------------------- |
| Framework      | `veryfront/head`    | `/_vf_modules/_veryfront/...`   |
| Internal       | `#veryfront/...`    | `/_vf_modules/_veryfront/...`   |
| Relative       | `./Button`          | `/_vf_modules/...`              |
| NPM            | `lodash`            | `https://esm.sh/lodash`         |
| Cross-project  | `acme@1.0/@/Button` | Registry URL                    |
| Node builtin   | `node:fs`           | Kept (SSR) / polyfill (browser) |

See [`transforms/import-rewriter/README.md`](./transforms/import-rewriter/README.md) for full documentation.

---

## Dependency Layers

```
Foundation (0 deps)
└─ config/, types/, utils/, errors/, platform/, fs/, schemas/

Infrastructure (foundation only)
└─ security/, routing/, middleware/, extensions/

Module System (foundation + infrastructure)
└─ modules/, transforms/, cache/, bundler/, registry/

Features (foundation + infrastructure + modules)
└─ data/, html/, react/, rendering/, markdown/, mdx/

AI (foundation + tool + extensions)
└─ tool/, agent/, workflow/, prompt/, resource/, mcp/, provider/,
   skill/, chat/, discovery/, embedding/, sandbox/

Services (AI + infrastructure)
└─ jobs/, task/, channels/, integrations/, internal-agents/

Orchestrators (most modules)
└─ server/, proxy/, build/, cli/
```

**Rules**:

1. Foundation modules have no internal dependencies
2. Infrastructure depends only on foundation
3. Features depend on foundation + infrastructure
4. AI modules depend on foundation + tool + extensions
5. Services depend on AI + infrastructure
6. Orchestrators can depend on most modules
7. **NO circular dependencies**

---

## Import Aliases

All internal imports use `#veryfront/*` aliases defined in `deno.json`:

```typescript
// Good - Using import alias
import { createRenderer } from "#veryfront/rendering";
import { serverLogger } from "#veryfront/utils";

// Bad - Deep relative import
import { createRenderer } from "../../../../rendering/index.ts";
```

---

## Testing

Each module has co-located tests:

```bash
# Run all tests
deno task test

# Run specific module tests
deno task test src/transforms/
deno task test src/rendering/
```

---

## Learn More

- Individual module READMEs: `src/<module>/README.md`
