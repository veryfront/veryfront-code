# Veryfront Documentation

Modern React framework with multi-runtime support, flexible rendering modes, and native AI agent capabilities.

## Getting Started

- [Introduction](./learn/introduction.md) - What is Veryfront and why use it
- [Installation](./learn/installation.md) - Install on Deno, Node.js, or Bun
- [Quick Start](./learn/quickstart.md) - Build your first app
- [Project Structure](./learn/project-structure.md) - File organization and conventions

## Core Concepts

### Routing

- [Overview](./guides/routing/README.md) - File-based routing system
- [App Router](./guides/routing/app-router.md) - Modern routing with nested layouts
- [Pages Router](./guides/routing/pages-router.md) - Traditional file-based routing
- [Dynamic Routes](./guides/routing/dynamic-routes.md) - URL parameters and catch-all routes
- [API Routes](./guides/routing/api-routes.md) - Server-side API endpoints

### Rendering

- [Overview](./guides/rendering/README.md) - Available rendering strategies
- [SSR](./guides/rendering/ssr.md) - Server-Side Rendering
- [SSG](./guides/rendering/ssg.md) - Static Site Generation
- [ISR](./guides/rendering/isr.md) - Incremental Static Regeneration
- [JIT](./guides/rendering/jit.md) - Just-In-Time Rendering
- [RSC](./guides/rendering/rsc.md) - React Server Components (experimental)

### Data Fetching

- [getServerData](./reference/functions/get-server-data.md) - Fetch data on the server
- [getStaticPaths](./reference/functions/get-static-paths.md) - Define static paths for SSG
- [redirect](./reference/functions/redirect.md) - Redirect responses
- [notFound](./reference/functions/not-found.md) - Return 404 responses

## AI Agent System

- [Overview](./ai/README.md) - Built-in AI capabilities
- [Getting Started](./ai/getting-started.md) - Create your first agent

### Reference

- [Agents](./reference/ai/agent.md) - Agent configuration and API
- [Tools](./reference/ai/tools.md) - Tool definition and discovery
- [Hooks](./reference/ai/hooks.md) - React hooks for AI features
- [Integrations](./reference/ai/integrations.md) - Third-party service integrations

## Components

- [Link](./reference/components/link.md) - Client-side navigation
- [Head](./reference/components/head.md) - Document head management
- [OptimizedImage](./reference/components/optimized-image.md) - Image optimization

## Hooks

- [useRouter](./reference/hooks/use-router.md) - Programmatic navigation
- [useParams](./reference/hooks/use-params.md) - URL parameters
- [usePathname](./reference/hooks/use-pathname.md) - Current pathname
- [useSearchParams](./reference/hooks/use-search-params.md) - Query string parameters

## Platform Support

- [Platform Adapters](./guides/adapters/platform/overview.md) - Multi-runtime architecture
- [Filesystem Adapters](./guides/adapters/filesystem/overview.md) - Filesystem abstraction

### Deployment

- [Deno](./guides/deployment/deno.md) - Deploy to Deno Deploy
- [Node.js](./guides/deployment/node.md) - Deploy with Node.js
- [Bun](./guides/deployment/bun.md) - Deploy with Bun
- [Cloudflare Workers](./guides/deployment/cloudflare.md) - Deploy to Cloudflare

## Reference

- [Configuration](./reference/configuration/README.md) - `veryfront.config.ts` options
- [CLI](./reference/cli/README.md) - Command-line interface
- [File Conventions](./reference/file-conventions/README.md) - Special files and naming

## Guides

- [Components](./guides/components/README.md) - Built-in components
- [Middleware](./guides/middleware/README.md) - Request/response middleware
- [Performance](./guides/performance/README.md) - Optimization techniques
- [Testing](./guides/testing/README.md) - Unit and E2E testing
- [Architecture](./guides/architecture/README.md) - Framework internals
- [Troubleshooting](./guides/troubleshooting/README.md) - Common issues

## Cookbooks

- [RAG Chatbot](./cookbooks/rag-chatbot.md) - Build a knowledge-base chatbot
- [All Recipes](./cookbooks/README.md) - Browse cookbook recipes

## Community

- [Contributing](./community/contributing.md) - Contribution guidelines
- [Changelog](./community/changelog.md) - Version history

## Additional Resources

- [Examples](https://github.com/veryfrontjs/veryfront/tree/main/examples) - Example projects
- [Source Code READMEs](../src/) - Module documentation
- [llms.txt](./llms.txt) - LLM-optimized project summary
