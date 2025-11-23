---
title: "Guides Index"
category: "guides"
level: "beginner"
keywords: ["guides", "tutorials", "how-to", "deployment", "patterns"]
ai_summary: "Index of all Veryfront guides including tutorials, deployment guides, and common patterns"
related: ["quick-start", "routing/README", "rendering/README"]
version: "0.1.0"
last_updated: "2025-11-22"
---

# Guides

Step-by-step tutorials and how-to guides for building applications with Veryfront.

## Getting Started

**New to Veryfront?** Start here:

- **[Quick Start](../quick-start.md)** - Build your first Veryfront app in 5 minutes
- **[Installation Guide](../getting-started/installation.md)** - Install for Deno, Node.js, Bun, or Cloudflare Workers
- **[Introduction](../introduction.md)** - What is Veryfront and why use it?

## Core Concepts

Understand the fundamentals:

### Routing
- **[Routing Overview](../routing/README.md)** - File-based routing with App Router and Pages Router
- **[App Router](../routing/app-router.md)** - Next.js 13+ style routing with layouts
- **[Pages Router](../routing/pages-router.md)** - Next.js 12 style routing
- **[Dynamic Routes](../routing/dynamic-routes.md)** - URL parameters with [slug] syntax
- **[API Routes](../routing/api-routes.md)** - Server-side API endpoints

### Rendering
- **[Rendering Overview](../rendering/README.md)** - All five rendering modes
- **[Rendering Comparison](../rendering/comparison.md)** - Choose the right mode
- **[SSR Guide](../rendering/ssr.md)** - Server-Side Rendering
- **[SSG Guide](../rendering/ssg.md)** - Static Site Generation
- **[ISR Guide](../rendering/isr.md)** - Incremental Static Regeneration
- **[JIT Guide](../rendering/jit.md)** - Just-In-Time Rendering

### Data Fetching
- **[Data Fetching Patterns](./data-fetching-patterns.md)** - Common patterns for fetching data
- **[Server-Side Data](/reference/functions/data-fetching.md)** - API reference for getServerData

## Tutorials

Build complete applications:

### Beginner
- **[Building a Blog](./building-blog.md)** - Create a full-featured blog
- **[Static Site](./static-site.md)** - Build a fast static website
- **[Simple API](./simple-api.md)** - Create REST API endpoints

### Intermediate
- **[Authentication](./authentication.md)** - Add user authentication
- **[Database Integration](./database.md)** - Connect to databases
- **[Form Handling](./forms.md)** - Handle forms and validation
- **[File Uploads](./file-uploads.md)** - Upload and process files

### Advanced
- **[Real-Time Features](./real-time.md)** - WebSockets and Server-Sent Events
- **[Background Jobs](./background-jobs.md)** - Async workers and queues
- **[Multi-Tenant Apps](./multi-tenant.md)** - Build SaaS applications
- **[Microservices](./microservices.md)** - Service-oriented architecture

## Deployment

Deploy your application:

### Production Deployment
- **[Deno Deploy](./deployment/deno.md)** ⭐ Recommended - Native Deno deployment
- **[Node.js Deployment](./deployment/node.md)** - Vercel, Railway, DigitalOcean
- **[Bun Deployment](./deployment/bun.md)** - High-performance Bun runtime
- **[Cloudflare Workers](./deployment/cloudflare.md)** - Edge deployment

### CI/CD & DevOps
- **[GitHub Actions](./deployment/github-actions.md)** - Automated deployments
- **[Docker Containers](./deployment/docker.md)** - Containerize your app
- **[Environment Variables](./deployment/env-vars.md)** - Managing secrets
- **[Monitoring](./deployment/monitoring.md)** - Application monitoring

## AI Integration

Build AI-powered applications:

### Getting Started with AI
- **[AI Quick Start](../ai/getting-started.md)** - Build AI apps in 5 minutes
- **[AI Specification](../ai/specification.md)** - Complete AI system documentation
- **[AI Summary](../ai/summary.md)** - Quick reference guide

### AI Patterns
- **[Chat Interfaces](./ai/chat.md)** - Build conversational UIs
- **[RAG Systems](./ai/rag.md)** - Retrieval-Augmented Generation
- **[Agent Workflows](./ai/agents.md)** - Multi-agent orchestration
- **[Tool Integration](./ai/tools.md)** - Custom AI tools

## Performance

Optimize your application:

- **[Performance Guide](./performance.md)** - Comprehensive optimization guide
- **[Image Optimization](./image-optimization.md)** - Optimize images for web
- **[Code Splitting](./code-splitting.md)** - Reduce bundle sizes
- **[Caching Strategies](./caching.md)** - Client and server caching
- **[Bundle Analysis](./bundle-analysis.md)** - Analyze and reduce bundles

## Styling & UI

Style your application:

- **[Styling Guide](./styling.md)** - All styling approaches
- **[CSS Modules](./css-modules.md)** - Scoped CSS
- **[Tailwind CSS](./tailwind.md)** - Utility-first CSS
- **[CSS-in-JS](./css-in-js.md)** - Styled Components, Emotion
- **[Dark Mode](./dark-mode.md)** - Implement theme switching

## Content & Media

Work with content:

- **[MDX Integration](./mdx.md)** - Markdown with React components
- **[Content Collections](./content-collections.md)** - Organize content
- **[Image Handling](./images.md)** - Upload, optimize, serve images
- **[Video Streaming](./video.md)** - Serve video content
- **[SEO Optimization](./seo.md)** - Search engine optimization

## Architecture

Design patterns and best practices:

- **[Architecture Overview](../architecture.md)** - System architecture
- **[Project Structure](./project-structure.md)** - Organize your code
- **[State Management](./state-management.md)** - Client-side state
- **[Error Handling](./error-handling.md)** - Robust error handling
- **[Testing](./testing.md)** - Unit, integration, and e2e tests

## Security

Secure your application:

- **[Security Best Practices](./security.md)** - Comprehensive security guide
- **[Authentication](./authentication.md)** - User authentication
- **[Authorization](./authorization.md)** - Role-based access control
- **[CORS](./cors.md)** - Cross-Origin Resource Sharing
- **[Rate Limiting](./rate-limiting.md)** - Protect your APIs

## Migration

Move to Veryfront:

- **[From Next.js](./migration/nextjs.md)** - Migrate Next.js apps
- **[From React](./migration/react.md)** - Migrate Create React App
- **[From Remix](./migration/remix.md)** - Migrate Remix apps
- **[From Gatsby](./migration/gatsby.md)** - Migrate Gatsby sites

## Examples

Learn by example - see the `/examples/` directory:

### Core Examples (9 examples)
- **[Minimal App Router](/examples/minimal-app-router/)** - Simplest App Router setup
- **[Minimal Pages](/examples/minimal-pages/)** - Simplest Pages Router setup
- **[Auth App](/examples/auth-app/)** - Authentication with protected routes
- **[Data Fetching Demo](/examples/data-fetching-demo/)** - All data fetching patterns
- **[Basic MDX](/examples/basic-mdx/)** - MDX integration
- **[Form Handling](/examples/form-handling/)** - Forms with validation
- **[Middleware Demo](/examples/middleware-demo/)** - Request/response middleware
- **[RSC Demo](/examples/rsc-demo/)** - React Server Components

### AI Examples (8 examples)
- **[AI Basic](/examples/ai-basic/)** - Simple AI agent integration
- **[AI Code Assistant](/examples/ai-code-assistant/)** - Complete code assistant
- **[Full Demo](/examples/full-demo/)** - All features including AI
- **[Knowledge Base](/examples/knowledge-base/)** - AI-powered search
- **[AI Autodiscovery](/examples/ai-autodiscovery/)** - Dynamic tool registration
- **[AI Phase 3](/examples/ai-phase3/)** - Advanced AI features
- **[AI Dev Tools](/examples/ai-dev-tools/)** - Developer tools
- **[AI SDK Integration](/examples/ai-sdk-integration/)** - External AI SDKs

### Infrastructure Examples (2 examples)
- **[Async Worker + Redis](/examples/async-worker-redis/)** - Background jobs
- **[Coding Agent](/examples/coding-agent/)** - Autonomous agent

## Common Use Cases

Guides for specific scenarios:

### E-commerce
- Build a product catalog with ISR
- Implement shopping cart with SSR
- Process payments with Stripe
- Manage inventory

### Content Sites
- Blog with dynamic routes and SSG
- Documentation with search
- Portfolio with image optimization
- News site with ISR

### Applications
- User dashboard with SSR
- Admin panel with auth
- Real-time chat
- Data visualization

### AI Applications
- Conversational interfaces
- Code generation tools
- Content generation
- Knowledge bases

## Tips & Tricks

Productivity boosters:

- **[VS Code Setup](./vscode-setup.md)** - Configure VS Code for Veryfront
- **[Debugging](./debugging.md)** - Debug effectively
- **[Hot Reload](./hot-reload.md)** - Fast development workflow
- **[TypeScript Tips](./typescript-tips.md)** - Advanced TypeScript patterns

## Troubleshooting

Common issues and solutions:

- **[Debugging Guide](../debugging.md)** - Complete debugging reference
- **[Common Errors](./common-errors.md)** - Error messages explained
- **[Performance Issues](./performance-issues.md)** - Diagnose slow apps
- **[Build Errors](./build-errors.md)** - Fix build problems

## Contributing

Help improve Veryfront:

- **[Contributing Guide](../contributing.md)** - How to contribute
- **[Documentation Guide](./writing-docs.md)** - Write documentation
- **[Code Style](./code-style.md)** - Coding standards
- **[Pull Request Guidelines](./pr-guidelines.md)** - Submit PRs

## By Topic

### Frontend Development
- Routing (App Router, Pages Router, Dynamic Routes)
- Rendering (SSR, SSG, ISR, JIT, RSC)
- Styling (CSS Modules, Tailwind, CSS-in-JS)
- Performance (Code Splitting, Lazy Loading, Caching)
- SEO (Meta Tags, Sitemaps, Structured Data)

### Backend Development
- API Routes (REST, GraphQL)
- Data Fetching (Server-Side, Client-Side)
- Authentication (Sessions, JWT, OAuth)
- Database (SQL, NoSQL, ORMs)
- Background Jobs (Workers, Queues)

### DevOps & Infrastructure
- Deployment (Deno Deploy, Vercel, Docker)
- CI/CD (GitHub Actions, GitLab CI)
- Monitoring (Logging, Metrics, Tracing)
- Scaling (CDN, Load Balancing, Edge)

### AI & Machine Learning
- AI Agents (LLM Integration, Tool Calling)
- RAG (Vector Search, Embeddings)
- Streaming (Real-time Responses)
- MCP (Model Context Protocol)

## By Skill Level

### Beginner (New to Veryfront)
1. [Quick Start](../quick-start.md) - Get started in 5 minutes
2. [Routing Overview](../routing/README.md) - Understand routing
3. [Rendering Comparison](../rendering/comparison.md) - Choose rendering mode
4. [Building a Blog](./building-blog.md) - First complete project

### Intermediate (Comfortable with basics)
1. [Data Fetching Patterns](./data-fetching-patterns.md) - Advanced patterns
2. [Authentication](./authentication.md) - Add user auth
3. [Database Integration](./database.md) - Connect databases
4. [Deployment Guide](./deployment/deno.md) - Deploy to production

### Advanced (Experienced developer)
1. [Architecture Overview](../architecture.md) - System design
2. [Performance Guide](./performance.md) - Optimize everything
3. [AI Integration](../ai/specification.md) - Build AI apps
4. [Microservices](./microservices.md) - Distributed systems

## By Goal

### Learn Veryfront
- Start: [Quick Start](../quick-start.md)
- Routing: [Routing Overview](../routing/README.md)
- Rendering: [Rendering Comparison](../rendering/comparison.md)
- Complete: [Building a Blog](./building-blog.md)

### Build a Website
- Blog: [Building a Blog](./building-blog.md)
- Docs: [Documentation Site](./docs-site.md)
- Marketing: [Static Site](./static-site.md)
- Portfolio: [Portfolio Site](./portfolio.md)

### Build an App
- SaaS: [Multi-Tenant Apps](./multi-tenant.md)
- Dashboard: [User Dashboard](./dashboard.md)
- E-commerce: [Online Store](./ecommerce.md)
- Social: [Social Platform](./social-platform.md)

### Add Features
- Auth: [Authentication](./authentication.md)
- Search: [Full-Text Search](./search.md)
- Real-Time: [WebSockets & SSE](./real-time.md)
- Payments: [Payment Integration](./payments.md)

### Optimize
- Speed: [Performance Guide](./performance.md)
- SEO: [SEO Optimization](./seo.md)
- Scale: [Scaling Guide](./scaling.md)
- Cost: [Cost Optimization](./cost-optimization.md)

## Learning Paths

### Full-Stack Developer Path
1. Quick Start → Routing → Rendering → Data Fetching
2. Authentication → Database → API Routes
3. Deployment → Monitoring → Scaling

### Frontend Developer Path
1. Quick Start → Routing → Components
2. Styling → Performance → SEO
3. State Management → Testing → Deployment

### AI Engineer Path
1. Quick Start → AI Getting Started → AI Specification
2. Agent Workflows → Tool Integration → RAG Systems
3. Production AI → Monitoring → Optimization

## Quick Reference

### Most Popular Guides
1. [Quick Start](../quick-start.md) - 5-minute setup
2. [Rendering Comparison](../rendering/comparison.md) - Choose rendering mode
3. [Deno Deployment](./deployment/deno.md) - Deploy to production
4. [Authentication](./authentication.md) - Add user auth
5. [Performance Guide](./performance.md) - Optimize everything

### Most Useful Patterns
1. [Data Fetching Patterns](./data-fetching-patterns.md) - Server & client data
2. [Error Handling](./error-handling.md) - Handle errors gracefully
3. [Caching Strategies](./caching.md) - Cache effectively
4. [State Management](./state-management.md) - Manage client state
5. [Testing Patterns](./testing.md) - Test your app

### Essential Reading
- **Before Starting:** [Introduction](../introduction.md) + [Quick Start](../quick-start.md)
- **Before Production:** [Deployment Guide](./deployment/deno.md) + [Security](./security.md)
- **Before Scaling:** [Performance](./performance.md) + [Monitoring](./deployment/monitoring.md)

## Related Documentation

- **[API Reference](/reference/functions/README.md)** - Complete API documentation
- **[Routing System](../routing/README.md)** - File-based routing
- **[Rendering Modes](../rendering/README.md)** - Five rendering strategies
- **[AI System](../ai/README.md)** - AI integration guide

## Getting Help

- **Examples:** Check `/examples/` directory for working code
- **Documentation:** Browse all docs at [docs.veryfront.com](/)
- **Issues:** Report bugs and request features on GitHub
- **Community:** Join discussions and get help

## What's Next?

Choose your path:

1. **New to Veryfront?** → [Quick Start](../quick-start.md)
2. **Building a site?** → [Building a Blog](./building-blog.md)
3. **Building an app?** → [Authentication](./authentication.md)
4. **Adding AI?** → [AI Getting Started](../ai/getting-started.md)
5. **Deploying?** → [Deno Deployment](./deployment/deno.md)
6. **Optimizing?** → [Performance Guide](./performance.md)
