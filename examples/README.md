# Veryfront Examples

This directory contains working example applications demonstrating various features of Veryfront.

## AI Examples

### 1. Agent Basic (`agent-basic/`)

**Start here for AI** - Core AI functionality demonstration:
- Agent creation with tools
- Tool definition and execution
- Platform detection
- Basic calculator example

**Run:** `deno run --allow-all example.ts`

[Full README](./agent-basic/README.md)

---

### 2. Autodiscovery (`autodiscovery/`)

Convention-driven AI component discovery:
- Auto-discover tools from `ai/tools/`
- Auto-register agents, resources, prompts
- MCP server creation
- Zero configuration

**Run:** `deno run --allow-all example.ts`

[Full README](./autodiscovery/README.md)

---

### 3. Workflow Memory (`workflow-memory/`)

Advanced agent capabilities:
- Memory strategies (conversation, buffer, summary)
- Agent composition (agent-as-tool)
- Multi-agent workflows (sequential & parallel)

**Run:** `deno run --allow-all example.ts`

[Full README](./workflow-memory/README.md)

---

### 4. Knowledge Base Bot (`knowledge-base/`)

RAG (Retrieval-Augmented Generation) example:
- Chat with your documentation
- Local vector store (JSON)
- Ingestion script with embeddings
- Context-aware answers

**Run:** `deno task dev`

[Full README](./knowledge-base/README.md)

---

### 5. Provider SDK Integration (`provider-sdk-integration/`)

Integration options and flexibility:
- Vercel AI SDK providers (30+ options)
- Custom provider implementation
- Hybrid approach (use both)

**Run:** `deno run --allow-all example.ts`

[Full README](./provider-sdk-integration/README.md)

---

### 6. Agent Dev Tools (`agent-dev-tools/`)

Testing and debugging utilities:
- Agent testing with expected behaviors
- Tool testing with various inputs
- Agent inspection and debugging
- Registry overview

**Run:** `deno run --allow-all example.ts`

[Full README](./agent-dev-tools/README.md)

---

### 7. Coding Agent (`coding-agent/`)

**Simple** AI coding assistant:
- Read/Write files and List directories
- Search codebase (Regex)
- Web search (Brave API)

**Run:** `deno task dev`

[Full README](./coding-agent/README.md)

---

### 8. Agent Code Assistant (`agent-code-assistant/`)

**Production-Ready** Code Assistant:
- Modern UI with syntax highlighting
- Rate limiting, Caching, Cost tracking
- Streaming tool calls
- Chat session management

**Run:** `deno task dev` (uses internal CLI)

[Full README](./agent-code-assistant/README.md)

---

### 9. Full Demo (`full-demo/`)

Complete AI feature showcase (CLI):
- All 8 implementation phases
- Real-world usage patterns
- Production-ready examples

**Run:** `deno run --allow-all demo.ts`

[Full README](./full-demo/README.md)

---

### 10. Durable Workflows (`durable-workflows/`)

DAG-based durable workflow system:
- Complex dependency graphs with parallel execution
- Human-in-the-loop approval gates
- Automatic checkpointing and recovery
- Auto-discovery of workflows, agents, and tools

**Run:** `cd examples/durable-workflows && deno task dev`

[Full README](./durable-workflows/README.md)

---

## Core Framework Examples

### 11. Minimal App Router (`minimal-app-router/`)

**Recommended starting point** - Comprehensive App Router demonstration:
- Root and nested pages (`/`, `/docs`)
- Loading states and error boundaries
- API routes (`/api/echo`)
- File structure best practices

**Size:** 44KB | **Router:** App Router

[Full README](./minimal-app-router/README.md)

---

### 12. Authentication App (`auth-app/`)

Complete authentication flow:
- Login and signup pages
- Protected routes
- Session management
- Auth provider pattern

**Size:** 32KB | **Router:** App Router

[Full README](./auth-app/README.md)

---

### 13. Data Fetching Demo (`data-fetching-demo/`)

Server-side data fetching patterns:
- `getServerData` for SSR
- `getStaticData` for SSG
- Dynamic and static routes
- Caching strategies

**Size:** 12KB | **Router:** Pages Router

[Full README](./data-fetching-demo/README.md)

---

### 14. Basic MDX Site (`basic-mdx/`)

MDX pages for content-focused websites:
- Markdown with JSX components
- Zero-config MDX support
- Frontmatter support
- MDX layouts

**Size:** 16KB | **Router:** Pages Router

[Full README](./basic-mdx/README.md)

---

### 15. Minimal Pages Router (`minimal-pages/`)

Traditional page-based routing:
- Simple file structure
- API routes
- Alternative to App Router
- Classic pattern

**Size:** 16KB | **Router:** Pages Router

[Full README](./minimal-pages/README.md)

---

### 16. RSC Demo (`rsc-demo/`)

**⚠️ Experimental**: React Server Components (RSC):
- Requires `VERYFRONT_EXPERIMENTAL_RSC=true`
- Server and client components
- Streaming rendering
- Zero-JS pages

**Size:** 16KB | **Router:** App Router

[Full README](./rsc-demo/README.md)

---

### 17. Form Handling (`form-handling/`)

Interactive data submission:
- Client-side forms
- POST API routes
- Validation and Error handling

**Size:** 20KB | **Router:** App Router

[Full README](./form-handling/README.md)

---

### 18. Middleware Demo (`middleware-demo/`)

Custom request pipeline:
- Request logging
- Route protection (Auth Guard)
- Response modification

**Size:** 15KB | **Router:** App Router

[Full README](./middleware-demo/README.md)

---

## Infrastructure & Scaling

### 19. Async Worker with Redis (`async-worker-redis/`)

Scalable background job processing:
- Redis Streams for job queue
- Consumer groups for horizontal scaling
- Decoupled API and Worker
- Robust state management

**Run:** `docker-compose up -d && deno task api`

[Full README](./async-worker-redis/README.md)

---

## Quick Reference

### Examples by Use Case

**Getting Started:**
- `minimal-app-router` - Modern App Router pattern
- `minimal-pages` - Classic Pages Router
- `basic-mdx` - Content-focused sites

**AI & Intelligent Apps:**
- `agent-basic` - Start here for AI features
- `autodiscovery` - Convention-driven approach
- `workflow-memory` - Advanced patterns
- `agent-dev-tools` - Testing & debugging
- `provider-sdk-integration` - Integration options
- `agent-code-assistant` - Production-ready assistant
- `full-demo` - Complete showcase
- `knowledge-base` - RAG / Chat with docs
- `durable-workflows` - DAG workflows with approvals

**Data & Rendering:**
- `data-fetching-demo` - SSR, SSG patterns
- `form-handling` - Forms and Mutations
- `rsc-demo` - Server Components (experimental)

**Security & Infrastructure:**
- `auth-app` - Authentication patterns
- `middleware-demo` - Custom Middleware
- `async-worker-redis` - Background Workers

---

## Setup

### Environment Variables

Most examples support `.env` files for configuration.

**Setup:**
```bash
# Copy .env file to example directory
cp .env.example agent-basic/.env

# Or create from template
cd agent-basic
cat > .env << EOF
OPENAI_API_KEY=sk-your-key-here
ANTHROPIC_API_KEY=sk-ant-your-key-here
NODE_ENV=development
EOF
```

**Common variables:**
```bash
# AI Examples
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Server
PORT=3000
NODE_ENV=development

# Debug
VERYFRONT_DEBUG=false
```

See root `.env.example` for a complete list of available variables.

## Running Examples

### AI Examples (Scripts)

```bash
cd agent-basic
deno run --allow-all example.ts
```

**Required permissions:**
- `--allow-net` - Network access for AI APIs
- `--allow-env` - Read environment variables
- `--allow-read` - Read .env files and source code

### Web App Examples (Servers)

```bash
cd minimal-app-router
deno task dev
# or
npm run dev
```

**Using the Veryfront CLI:**
```bash
cd examples/minimal-app-router
veryfront dev
```

---

## Learning Path

### New to Veryfront?

**Start here:**
1. **`minimal-app-router`** - Learn App Router (Next.js-style)
2. **`data-fetching-demo`** - Learn server-side data fetching
3. **`basic-mdx`** - Learn MDX support

**Then explore:**
4. **`auth-app`** - Learn authentication patterns
5. **`form-handling`** - Learn how to handle forms
6. **`middleware-demo`** - Learn middleware usage
7. **`rsc-demo`** - Learn Server Components (experimental)

### Want to build AI apps?

**Start here:**
1. **`agent-basic`** - Core AI concepts
2. **`autodiscovery`** - Convention-driven approach
3. **`workflow-memory`** - Advanced features

**Then explore:**
4. **`agent-dev-tools`** - Testing & debugging
5. **`provider-sdk-integration`** - Integration patterns
6. **`durable-workflows`** - DAG-based workflows
7. **`full-demo`** - Complete showcase

---

## Permissions Guide

**Minimal permissions (recommended for production):**
```bash
deno run \
  --allow-net=api.openai.com,api.anthropic.com \
  --allow-read=.,~/.env \
  --allow-env=OPENAI_API_KEY,ANTHROPIC_API_KEY,NODE_ENV \
  example.ts
```

**Development permissions (easier during development):**
```bash
deno run --allow-all example.ts
```

**Common permission flags:**
- `--allow-net` - Network access
- `--allow-read` - File system read
- `--allow-write` - File system write
- `--allow-env` - Environment variables
- `--allow-run` - Run subprocesses
- `--allow-all` - All permissions (dev only)

---

## Additional Resources

- **[Documentation](https://veryfront.com/docs/framework)** - Complete framework documentation

---

## Contributing Examples

Have a useful example? Contributions welcome!

### Example Guidelines

When contributing examples:
- ✅ Create a directory with a complete runnable app
- ✅ Include comprehensive README.md with setup instructions
- ✅ Keep it focused on one feature or pattern
- ✅ Test with `.env` file support
- ✅ Test that it works with `veryfront dev` or `deno run`
- ✅ Include `.env.example` if needed
- ❌ Don't add loose .ts/.tsx files (put them in docs instead)
- ❌ Don't duplicate existing examples

**Example structure:**
```
example-name/
├── README.md              # Comprehensive documentation
├── example.ts             # Main entry point (or demo.ts)
├── .env.example           # Environment template (if needed)
├── package.json           # For npm/deno dependencies (optional)
└── [other files]          # Supporting files as needed
```

See our [Contributing Guide](../CONTRIBUTING.md) for more details.

---

## Tips

- **All examples are production-ready** - Code quality is high
- **Each example is self-contained** - No dependencies between examples
- **Examples use real patterns** - Not just toy examples
- **Deno is primary** - But most work with Node.js/Bun too
- **.env files are supported** - Easy configuration
- **READMEs are comprehensive** - Each example has full docs

---

## Need Help?

1. Check the example's README first
2. Review [documentation](https://veryfront.com/docs/framework)
3. Look at similar examples for patterns
4. Open an issue on GitHub