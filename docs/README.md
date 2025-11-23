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
- [Routing](./routing/README.md) - File-based routing (App Router & Pages Router)
- [Rendering](./rendering/README.md) - SSR, SSG, ISR, JIT, and RSC
- [Data Fetching](./data-fetching/README.md) - Server data, static props, and caching
- [Styling](./styling/README.md) - CSS, Tailwind, CSS-in-JS
- [MDX](./mdx.md) - Zero-config MDX support

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
- [Memory & Composition](../examples/ai-phase3/) - Advanced features

#### **Platform Adapters**
- [Overview](./platform-adapters/overview.md) - Multi-runtime support
- [Deno](./platform-adapters/deno.md) - Deploy on Deno & Deno Deploy
- [Node.js](./platform-adapters/nodejs.md) - Deploy on Node.js
- [Bun](./platform-adapters/bun.md) - Deploy on Bun
- [Cloudflare Workers](./platform-adapters/cloudflare.md) - Deploy on Cloudflare

#### **Filesystem Adapters**
- [Overview](./filesystem-adapters/overview.md) - Filesystem abstraction
- [Local Disk](./filesystem-adapters/local.md) - Standard filesystem (default)
- [Veryfront API](./filesystem-adapters/veryfront-api.md) - Remote project rendering
- [Custom Adapters](./filesystem-adapters/custom.md) - Build your own

#### **API Reference**
- [Configuration](./api/configuration.md) - veryfront.config.ts reference
- [Components](./api/components.md) - Link, Head, OptimizedImage, etc.
- [Data Fetching](./api/data-fetching.md) - getServerData, getStaticPaths
- [API Routes](./api/routes.md) - Building API endpoints
- [Middleware](./api/middleware.md) - Request/response middleware
- [CLI](./api/cli.md) - Command-line interface

#### **Guides**
- [Building a Blog](./guides/blog.md) - Step-by-step tutorial
- [Image Optimization](./guides/images.md) - OptimizedImage best practices
- [Performance](./guides/performance.md) - Optimization techniques
- [Deployment](./guides/deployment.md) - Deploy to production
- [Migration](./guides/migration.md) - Migrate from Next.js/Remix

#### **Cookbooks**
- [RAG Chatbot](./cookbooks/rag-chatbot.md) - Build a knowledge-base bot
- [Cookbook Index](./cookbooks/README.md) - Browse all recipes

#### **Advanced**
- [Architecture](./advanced/architecture.md) - Framework internals
- [Security](./advanced/security.md) - CORS, CSP, input validation
- [Observability](./advanced/observability.md) - Metrics and tracing
- [Custom Builds](./advanced/custom-builds.md) - Advanced build configuration

#### **Community**
- [Contributing](./community/contributing.md) - How to contribute
- [Changelog](./community/changelog.md) - Version history
- [Examples](./community/examples.md) - Example projects
- [FAQ](./community/faq.md) - Frequently asked questions

## Publishing

This documentation is designed to be published with:
- [VitePress](https://vitepress.dev/) (recommended)
- [Docusaurus](https://docusaurus.io/)
- [MkDocs](https://www.mkdocs.org/)
- Or any Markdown-based documentation generator

## Navigation

For code navigation within the framework source, see:
- [Code Navigation Guide](../src/NAVIGATION.md)
- [Module READMEs](../src/) - All 16 modules documented (including AI module)
- [AI Documentation Index](./ai/README.md) - Complete AI documentation guide

## Contributing to Docs

See [Contributing Guide](./community/contributing.md) for guidelines on improving documentation.
