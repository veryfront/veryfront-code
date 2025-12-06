# Veryfront Documentation

Modern React framework for Deno with multi-runtime support, flexible rendering modes, and native agent capabilities.

## Documentation Structure

This directory contains the complete Veryfront documentation organized for easy navigation and publishing.

###  Documentation Sections

#### **Getting Started**
- [Introduction](./learn/introduction.md) - What is Veryfront?
- [Quick Start](./learn/quickstart.md) - Get up and running in 5 minutes
- [Project Structure](./learn/project-structure.md) - File layout and organization
- [Installation](./learn/installation.md) - Different ways to install Veryfront

#### **Core Concepts**
- [Convention over Configuration](./learn/concepts/convention-over-configuration.md) - The framework philosophy
- [Routing](/guides/routing/README.md) - File-based routing (App Router & Pages Router)
- [Rendering](/guides/rendering/README.md) - SSR, SSG, ISR, JIT, and RSC
- [Data Fetching](/reference/functions/README.md) - Server data, static props, and caching
- [Styling](/guides/components/README.md) - CSS, Tailwind, CSS-in-JS
- [MDX](https://github.com/veryfrontjs/veryfront/tree/main/examples/basic-mdx) - Zero-config MDX support

#### **Agent System**

**Start Here:**
- [AI Capabilities Overview](./ai/README.md) - Complete guide to AI features
- [Getting Started](./ai/getting-started.md) - Build with agents in 5 minutes

**Reference:**
- [AI API Reference](./reference/ai/README.md) - Agents, Tools, and Hooks API
- [Specification](./ai/specification.md) - Technical spec
- [Implementation Status](./ai/implementation-status.md) - Feature matrix

**Module Documentation:**
- [Core Module](../src/ai/README.md) - Agent runtime, tools, MCP, memory
- [React Hooks](../src/ai/react/README.md) - useChat, useAgent, useCompletion
- [UI Primitives](../src/ai/react/primitives/README.md) - Unstyled components
- [Styled Components](../src/ai/react/components/README.md) - Production UI

**Examples:**
- [Complete Demo](../examples/full-demo/README.md) - Full-featured example
- [Auto-Discovery](../examples/ai-autodiscovery/) - Convention-driven setup
- [Memory & Composition](https://github.com/veryfrontjs/veryfront/tree/main/examples) - Advanced features

#### **Platform Adapters**
- [Overview](/guides/adapters/platform/overview.md) - Multi-runtime support
- [Deno](/guides/deployment/deno.md) - Deploy on Deno & Deno Deploy
- [Node.js](/guides/deployment/node.md) - Deploy on Node.js
- [Bun](/guides/deployment/bun.md) - Deploy on Bun
- [Cloudflare Workers](/guides/deployment/cloudflare.md) - Deploy on Cloudflare

#### **Filesystem Adapters**
- [Overview](/guides/adapters/filesystem/overview.md) - Filesystem abstraction
- [Local Disk](/guides/adapters/filesystem/overview.md) - Standard filesystem (default)
- [Veryfront API](/guides/adapters/filesystem/veryfront-api.md) - Remote project rendering
- [Custom Adapters](/guides/adapters/filesystem/overview.md) - Build your own

#### **API Reference**
- [Configuration](/reference/configuration/README.md) - veryfront.config.ts reference
- [Components](/reference/components/README.md) - Link, Head, OptimizedImage, etc.
- [Data Fetching](/reference/functions/get-server-data.md) - getServerData, getStaticPaths
- [API Routes](/guides/routing/api-routes.md) - Building API endpoints
- [Middleware](/guides/middleware/README.md) - Request/response middleware
- [CLI](/reference/cli/README.md) - Command-line interface

#### **Guides**
- [Building a Blog](https://github.com/veryfrontjs/veryfront/tree/main/examples/basic-mdx) - Step-by-step tutorial
- [Image Optimization](/guides/components/image.md) - OptimizedImage best practices
- [Performance](/guides/performance/README.md) - Optimization techniques
- [Deployment](/guides/deployment/README.md) - Deploy to production
- [Migration](/migration/) - Migrate from Next.js/Remix

#### **Cookbooks**
- [RAG Chatbot](./cookbooks/rag-chatbot.md) - Build a knowledge-base bot
- [Cookbook Index](./cookbooks/README.md) - Browse all recipes

#### **Advanced**
- [Architecture](/guides/architecture/README.md) - Framework internals
- [Security](/guides/middleware/README.md) - CORS, CSP, input validation
- [Observability](/guides/performance/README.md) - Metrics and tracing
- [Custom Builds](/reference/configuration/README.md) - Advanced build configuration

#### **Community**
- [Contributing](./community/contributing.md) - How to contribute
- [Changelog](./community/changelog.md) - Version history
- [Examples](https://github.com/veryfrontjs/veryfront/tree/main/examples) - Example projects
- [FAQ](/community/contributing.md) - Frequently asked questions

## Publishing

This documentation is designed to be published with:
- [VitePress](https://vitepress.dev/) (recommended)
- [Docusaurus](https://docusaurus.io/)
- [MkDocs](https://www.mkdocs.org/)
- Or any Markdown-based documentation generator

## Navigation

For code navigation within the framework source, see:
- [Code Navigation Guide](/guides/routing/README.md)
- [Module READMEs](../src/) - All 16 modules documented (including AI module)
- [AI Documentation Index](./ai/README.md) - Complete AI documentation guide

## Contributing to Docs

See [Contributing Guide](./community/contributing.md) for guidelines on improving documentation.
