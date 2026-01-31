# Veryfront Architecture

> Modern React meta-framework emphasizing clean module boundaries, runtime flexibility, and developer experience

## Design Philosophy

Veryfront's architecture is built on four core principles:

1. **Modular by Design** - Focused modules with clear boundaries and single responsibilities
2. **Runtime Agnostic** - Works across Deno, Node, Bun, and Cloudflare Workers
3. **Progressive Complexity** - Simple by default, powerful when needed
4. **AI-Native** - First-class AI agent integration via MCP protocol

## Core Concepts

### Rendering Modes

Veryfront supports multiple rendering strategies that can be mixed within the same application:

| Mode | Description | Use Case |
|------|-------------|----------|
| **SSR** | Server-side rendering | Dynamic content, personalization |
| **RSC** | React Server Components | Reduce client JS, streaming |
| **SSG** | Static site generation | Blog posts, documentation |
| **ISR** | Incremental static regeneration | E-commerce, news sites |
| **CSR** | Client-side rendering | Interactive dashboards |

### Routing Models

**App Router** (Recommended)
- File-based routing with `app/` directory
- Nested layouts and templates
- React Server Components support
- Streaming and suspense

**Pages Router** (Compatible)
- File-based routing with `pages/` directory
- `getServerData()` for SSR
- `getStaticPaths()` for SSG
- API routes support

### Module Architecture

```
┌─────────────────────────────────────────────┐
│              Application Code               │
│         (app/, pages/, components/)         │
└────────────────┬────────────────────────────┘
                 │
┌────────────────▼────────────────────────────┐
│         Server Layer (server/)              │
│    ┌──────────┬──────────┬────────────┐    │
│    │   Dev    │   Prod   │  Handlers  │    │
│    │  Server  │  Server  │   (RSC,    │    │
│    │  + HMR   │          │  SSR, API) │    │
│    └──────────┴──────────┴────────────┘    │
└────────────────┬────────────────────────────┘
                 │
┌────────────────▼────────────────────────────┐
│          Feature Modules                    │
│  ┌──────────┬──────────┬─────────────┐     │
│  │Rendering │  Build   │   Routing   │     │
│  │(SSR/RSC) │ (MDX/TS) │  (Matcher)  │     │
│  └──────────┴──────────┴─────────────┘     │
│  ┌──────────┬──────────┬─────────────┐     │
│  │   Data   │   HTML   │ Middleware  │     │
│  │ Fetching │   Shell  │   Pipeline  │     │
│  └──────────┴──────────┴─────────────┘     │
└────────────────┬────────────────────────────┘
                 │
┌────────────────▼────────────────────────────┐
│       Infrastructure Layer                  │
│  ┌──────────┬──────────┬─────────────┐     │
│  │ Security │  Module  │    React    │     │
│  │(CORS/CSP)│  System  │   Compat    │     │
│  └──────────┴──────────┴─────────────┘     │
└────────────────┬────────────────────────────┘
                 │
┌────────────────▼────────────────────────────┐
│          Foundation Layer                   │
│  ┌──────────┬──────────┬─────────────┐     │
│  │   Core   │ Platform │   Provider  │     │
│  │ (Types,  │ Adapters │  (OpenAI,   │     │
│  │  Config) │ (Deno+)  │  Anthropic) │     │
│  └──────────┴──────────┴─────────────┘     │
│  ┌──────────┬──────────┬─────────────┐     │
│  │  Agent   │   Tool   │  Workflow   │     │
│  │ Runtime  │ Registry │   Engine    │     │
│  └──────────┴──────────┴─────────────┘     │
│  ┌──────────┬──────────┬─────────────┐     │
│  │  Prompt  │ Resource │     MCP     │     │
│  │ Registry │ Registry │   Server    │     │
│  └──────────┴──────────┴─────────────┘     │
└─────────────────────────────────────────────┘
```

## Request Lifecycle

### SSR Request Flow

```
1. HTTP Request
   ↓
2. Server Handler (universal-handler/)
   ↓
3. Middleware Pipeline (security, logging, etc.)
   ↓
4. Route Matching (routing/)
   ↓
5. Data Fetching (data/)
   │
   ├─→ getServerData() for SSR
   └─→ getStaticData() for SSG
   ↓
6. Component Rendering (rendering/)
   │
   ├─→ SSR: React.renderToString()
   └─→ RSC: React.renderToPipeableStream()
   ↓
7. HTML Shell Generation (html/)
   │
   ├─→ Metadata injection
   ├─→ CSS injection
   └─→ Hydration scripts
   ↓
8. Response with Security Headers
```

### Build Process

```
1. Entry Discovery
   ↓
2. Dependency Analysis (module-system/)
   ↓
3. Transform Pipeline (build/transforms/)
   │
   ├─→ MDX → JSX (mdx/)
   ├─→ JSX → JS (jsx-runtime)
   └─→ TypeScript → JavaScript
   ↓
4. Asset Optimization (build/asset-pipeline/)
   │
   ├─→ CSS optimization (Tailwind/UnoCSS)
   ├─→ Image optimization (WebP, AVIF)
   └─→ Code splitting
   ↓
5. Bundle Generation (build/bundler/)
   ↓
6. Static HTML Generation (rendering/ + html/)
   ↓
7. Output (dist/)
   ├─→ static/ (HTML, CSS, images)
   ├─→ chunks/ (JS bundles)
   └─→ manifest.json (routing metadata)
```

## Runtime Abstraction

Veryfront runs on multiple JavaScript runtimes through a unified adapter interface:

| Runtime | Status | Use Case |
|---------|--------|----------|
| **Deno** | Primary | Development, edge, serverless |
| **Node.js** | Supported | Traditional hosting, containers |
| **Bun** | Supported | High-performance builds |
| **Cloudflare Workers** | Supported | Global edge deployment |

**Platform Adapter Interface:**
```typescript
interface RuntimeAdapter {
  fs: FileSystemAPI;
  kv?: KeyValueStore;
  fetch: typeof globalThis.fetch;
  runtime: 'deno' | 'node' | 'bun' | 'cloudflare';
}
```

## Security Model

1. **Input Validation**: All external input validated at boundaries using Zod schemas
2. **Path Traversal Protection**: Secure filesystem wrapper prevents directory escape
3. **CSP with Nonces**: Content Security Policy enforced with cryptographic nonces
4. **Security Headers**: Comprehensive headers (HSTS, X-Frame-Options, etc.)
5. **Sandboxed Execution**: User code runs in isolated workers

## Module Boundaries

### Dependency Rules

- **Foundation modules** (`core/`, `platform/`) → No dependencies
- **Infrastructure** (`security/`, `routing/`) → Only foundation
- **Features** (`rendering/`, `build/`) → Foundation + infrastructure
- **Orchestrators** (`server/`, `cli/`) → Can depend on most modules
- **NO circular dependencies** allowed (enforced by tooling)

### Import Strategy

All internal imports use `#veryfront/*` aliases:

```typescript
// Good
import { createRenderer } from "#veryfront/rendering";
import type { VeryfrontConfig } from "#veryfront/config";

// Bad
import { createRenderer } from "../../../../rendering/index.ts";
```

## AI Integration

Veryfront includes first-class AI agent support via dedicated modules:

| Module | Import | Purpose |
|--------|--------|---------|
| **Agent** | `veryfront/agent` | Agent runtime, memory, composition |
| **Tool** | `veryfront/tool` | Tool definitions, registry, execution |
| **Workflow** | `veryfront/workflow` | Durable DAG-based workflow engine |
| **Prompt** | `veryfront/prompt` | Prompt templates and registry |
| **Resource** | `veryfront/resource` | Resource definitions and registry |
| **MCP** | `veryfront/mcp` | Model Context Protocol server |
| **Provider** | `veryfront/provider` | OpenAI, Anthropic, Google adapters |

**Features:**
- Production middleware: rate limiting, caching, cost tracking
- React hooks for streaming responses (`useChat`, `useAgent`)
- Auto-discovery of tools, prompts, and resources

## Performance Strategy

1. **Lazy Loading**: Modules loaded on-demand
2. **Multi-Layer Caching**: Render, build, and data caching
3. **Code Splitting**: Automatic route-based splitting
4. **Streaming SSR**: Faster time-to-first-byte
5. **Edge Deployment**: Run close to users

## Development Tooling

- **HMR**: Hot module replacement for instant feedback
- **Error Overlay**: Rich error messages with source maps
- **Type Safety**: Full TypeScript support
- **Testing**: Unit and integration test suites
- **CLI**: Batteries-included dev tools

## Related Documentation

- `src/README.md` - Module reference
- `examples/` - Working code examples
- `AGENTS.md` - Quick start and commands
