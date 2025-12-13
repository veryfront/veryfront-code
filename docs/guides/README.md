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

- **[Quick Start](/learn/quickstart.md)** - Build your first Veryfront app in 5 minutes
- **[Installation Guide](/learn/installation.md)** - Install for Deno, Node.js, Bun, or Cloudflare Workers
- **[Introduction](/learn/introduction.md)** - What is Veryfront and why use it?

## Core Concepts

Understand the fundamentals:

### Routing
- **[Routing Overview](/guides/routing/README.md)** - File-based routing with App Router and Pages Router
- **[App Router](/guides/routing/app-router.md)** - Next.js 13+ style routing with layouts
- **[Pages Router](/guides/routing/pages-router.md)** - Next.js 12 style routing
- **[Dynamic Routes](/guides/routing/dynamic-routes.md)** - URL parameters with [slug] syntax
- **[API Routes](/guides/routing/api-routes.md)** - Server-side API endpoints

### Rendering
- **[Rendering Overview](/guides/rendering/README.md)** - All five rendering modes
- **[Rendering Comparison](/guides/rendering/comparison.md)** - Choose the right mode
- **[SSR Guide](/guides/rendering/ssr.md)** - Server-Side Rendering
- **[SSG Guide](/guides/rendering/ssg.md)** - Static Site Generation
- **[ISR Guide](/guides/rendering/isr.md)** - Incremental Static Regeneration
- **[JIT Guide](/guides/rendering/jit.md)** - Just-In-Time Rendering

### Data Fetching
- **[Data Fetching Patterns](/reference/functions/get-server-data.md)** - Common patterns for fetching data
- **[Server-Side Data](/reference/functions/get-server-data.md)** - API reference for getServerData

## Tutorials

Build complete applications:

### Beginner
- **[Building a Blog](https://github.com/veryfrontjs/veryfront/tree/main/examples/basic-mdx)** - Create a full-featured blog
- **[Static Site](/guides/rendering/ssg.md)** - Build a fast static website
- **[Simple API](/guides/routing/api-routes.md)** - Create REST API endpoints

### Intermediate
- **[Authentication](https://github.com/veryfrontjs/veryfront/tree/main/examples/auth-app)** - Add user authentication
- **[Database Integration](/reference/functions/get-server-data.md)** - Connect to databases
- **[Form Handling](https://github.com/veryfrontjs/veryfront/tree/main/examples/form-handling)** - Handle forms and validation
- **[File Uploads](/guides/routing/api-routes.md)** - Upload and process files

### Advanced
- **[Real-Time Features](/guides/routing/api-routes.md)** - WebSockets and Server-Sent Events
- **[Background Jobs](https://github.com/veryfrontjs/veryfront/tree/main/examples/async-worker-redis)** - Async workers and queues
- **[Multi-Tenant Apps](/guides/architecture/README.md)** - Build SaaS applications
- **[Microservices](/guides/architecture/README.md)** - Service-oriented architecture

## Deployment

Deploy your application:

### Production Deployment
- **[Deno Deploy](./deployment/deno.md)** (Recommended) - Native Deno deployment
- **[Node.js Deployment](./deployment/node.md)** - Vercel, Railway, DigitalOcean
- **[Bun Deployment](./deployment/bun.md)** - High-performance Bun runtime
- **[Cloudflare Workers](./deployment/cloudflare.md)** - Edge deployment

### CI/CD & DevOps
- **[GitHub Actions](/guides/deployment/README.md)** - Automated deployments
- **[Docker Containers](/guides/deployment/README.md)** - Containerize your app
- **[Environment Variables](/reference/configuration/README.md)** - Managing secrets
- **[Monitoring](/guides/deployment/README.md)** - Application monitoring

## AI Integration

Build AI-powered applications:

### Getting Started with AI
- **[AI Quick Start](../ai/getting-started.md)** - Build AI apps in 5 minutes
- **[AI Overview](../ai/README.md)** - Complete AI capabilities overview
- **[AI Reference](../reference/ai/README.md)** - API reference

### AI Patterns
- **[Chat Interfaces](/ai/getting-started.md)** - Build conversational UIs
- **[RAG Systems](/ai/README.md)** - Retrieval-Augmented Generation
- **[Agent Workflows](/reference/ai/agent.md)** - Multi-agent orchestration
- **[Tool Integration](/reference/ai/tools.md)** - Custom AI tools

## Performance

Optimize your application:

- **[Performance Guide](/guides/performance/README.md)** - Comprehensive optimization guide
- **[Image Optimization](/guides/components/image.md)** - Optimize images for web
- **[Code Splitting](/guides/performance/optimization.md)** - Reduce bundle sizes
- **[Caching Strategies](/guides/performance/caching.md)** - Client and server caching
- **[Bundle Analysis](/guides/performance/optimization.md)** - Analyze and reduce bundles

## Styling & UI

Style your application:

- **[Styling Guide](/guides/components/README.md)** - All styling approaches
- **[CSS Modules](/guides/components/README.md)** - Scoped CSS
- **[Tailwind CSS](/guides/components/README.md)** - Utility-first CSS
- **[CSS-in-JS](/guides/components/README.md)** - Styled Components, Emotion
- **[Dark Mode](/guides/components/README.md)** - Implement theme switching

## Content & Media

Work with content:

- **[MDX Integration](https://github.com/veryfrontjs/veryfront/tree/main/examples/basic-mdx)** - Markdown with React components
- **[Content Collections](https://github.com/veryfrontjs/veryfront/tree/main/examples/basic-mdx)** - Organize content
- **[Image Handling](/guides/components/image.md)** - Upload, optimize, serve images
- **[Video Streaming](/guides/components/README.md)** - Serve video content
- **[SEO Optimization](/guides/components/head.md)** - Search engine optimization

## Architecture

Design patterns and best practices:

- **[Architecture Overview](/guides/architecture/README.md)** - System architecture
- **[Project Structure](/learn/project-structure.md)** - Organize your code
- **[State Management](/guides/components/README.md)** - Client-side state
- **[Error Handling](/reference/functions/not-found.md)** - Robust error handling
- **[Testing](/guides/testing/README.md)** - Unit, integration, and e2e tests

## Security

Secure your application:

- **[Security Best Practices](/guides/middleware/README.md)** - Comprehensive security guide
- **[Authentication](https://github.com/veryfrontjs/veryfront/tree/main/examples/auth-app)** - User authentication
- **[Authorization](https://github.com/veryfrontjs/veryfront/tree/main/examples/auth-app)** - Role-based access control
- **[CORS](/guides/middleware/README.md)** - Cross-Origin Resource Sharing
- **[Rate Limiting](/guides/middleware/README.md)** - Protect your APIs

## Migration

Move to Veryfront:

- **[From Next.js](/migration/)** - Migrate Next.js apps
- **[From React](/migration/)** - Migrate Create React App
- **[From Remix](/migration/)** - Migrate Remix apps
- **[From Gatsby](/migration/)** - Migrate Gatsby sites

## Examples

Learn by example - see the `/examples/` directory:

### Core Examples (9 examples)
- **[Minimal App Router](https://github.com/veryfrontjs/veryfront/tree/main/examples/minimal-app-router)** - Simplest App Router setup
- **[Minimal Pages](https://github.com/veryfrontjs/veryfront/tree/main/examples/minimal-pages)** - Simplest Pages Router setup
- **[Auth App](https://github.com/veryfrontjs/veryfront/tree/main/examples/auth-app)** - Authentication with protected routes
- **[Data Fetching Demo](https://github.com/veryfrontjs/veryfront/tree/main/examples/data-fetching-demo)** - All data fetching patterns
- **[Basic MDX](https://github.com/veryfrontjs/veryfront/tree/main/examples/basic-mdx)** - MDX integration
- **[Form Handling](https://github.com/veryfrontjs/veryfront/tree/main/examples/form-handling)** - Forms with validation
- **[Middleware Demo](https://github.com/veryfrontjs/veryfront/tree/main/examples/middleware-demo)** - Request/response middleware
- **[RSC Demo](https://github.com/veryfrontjs/veryfront/tree/main/examples/rsc-demo)** - React Server Components

### AI Examples (8 examples)
- **[AI Basic](https://github.com/veryfrontjs/veryfront/tree/main/examples/ai-basic)** - Simple AI agent integration
- **[AI Code Assistant](https://github.com/veryfrontjs/veryfront/tree/main/examples/ai-code-assistant)** - Complete code assistant
- **[Full Demo](https://github.com/veryfrontjs/veryfront/tree/main/examples/full-demo)** - All features including AI
- **[Knowledge Base](https://github.com/veryfrontjs/veryfront/tree/main/examples/knowledge-base)** - AI-powered search
- **[AI Autodiscovery](https://github.com/veryfrontjs/veryfront/tree/main/examples/ai-autodiscovery)** - Dynamic tool registration
- **[AI Phase 3](https://github.com/veryfrontjs/veryfront/tree/main/examples/ai-phase3)** - Advanced AI features
- **[AI Dev Tools](https://github.com/veryfrontjs/veryfront/tree/main/examples/ai-dev-tools)** - Developer tools
- **[AI SDK Integration](https://github.com/veryfrontjs/veryfront/tree/main/examples/ai-sdk-integration)** - External AI SDKs

### Infrastructure Examples (2 examples)
- **[Async Worker + Redis](https://github.com/veryfrontjs/veryfront/tree/main/examples/async-worker-redis)** - Background jobs
- **[Coding Agent](https://github.com/veryfrontjs/veryfront/tree/main/examples/coding-agent)** - Autonomous agent

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

- **[VS Code Setup](/learn/installation.md)** - Configure VS Code for Veryfront
- **[Debugging](/guides/troubleshooting/debugging.md)** - Debug effectively
- **[Hot Reload](/guides/troubleshooting/debugging.md)** - Fast development workflow
- **[TypeScript Tips](/guides/troubleshooting/README.md)** - Advanced TypeScript patterns

## Troubleshooting

Common issues and solutions:

- **[Debugging Guide](/guides/troubleshooting/debugging.md)** - Complete debugging reference
- **[Common Errors](/guides/troubleshooting/README.md)** - Error messages explained
- **[Performance Issues](/guides/performance/README.md)** - Diagnose slow apps
- **[Build Errors](/guides/troubleshooting/README.md)** - Fix build problems

## Contributing

Help improve Veryfront:

- **[Contributing Guide](/community/contributing.md)** - How to contribute
- **[Documentation Guide](/community/contributing.md)** - Write documentation
- **[Code Style](/community/contributing.md)** - Coding standards
- **[Pull Request Guidelines](/community/contributing.md)** - Submit PRs

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
1. [Quick Start](/learn/quickstart.md) - Get started in 5 minutes
2. [Routing Overview](/guides/routing/README.md) - Understand routing
3. [Rendering Comparison](/guides/rendering/comparison.md) - Choose rendering mode
4. [Building a Blog](https://github.com/veryfrontjs/veryfront/tree/main/examples/basic-mdx) - First complete project

### Intermediate (Comfortable with basics)
1. [Data Fetching Patterns](/reference/functions/get-server-data.md) - Advanced patterns
2. [Authentication](https://github.com/veryfrontjs/veryfront/tree/main/examples/auth-app) - Add user auth
3. [Database Integration](/reference/functions/get-server-data.md) - Connect databases
4. [Deployment Guide](./deployment/deno.md) - Deploy to production

### Advanced (Experienced developer)
1. [Architecture Overview](/guides/architecture/README.md) - System design
2. [Performance Guide](/guides/performance/README.md) - Optimize everything
3. [AI Integration](../ai/getting-started.md) - Build AI apps
4. [Deployment](/guides/deployment/README.md) - Production deployment

## By Goal

### Learn Veryfront
- Start: [Quick Start](/learn/quickstart.md)
- Routing: [Routing Overview](/guides/routing/README.md)
- Rendering: [Rendering Comparison](/guides/rendering/comparison.md)
- Complete: [Building a Blog](https://github.com/veryfrontjs/veryfront/tree/main/examples/basic-mdx)

### Build a Website
- Blog: [Building a Blog](https://github.com/veryfrontjs/veryfront/tree/main/examples/basic-mdx)
- Docs: [Documentation Site](https://github.com/veryfrontjs/veryfront/tree/main/examples)
- Marketing: [Static Site](/guides/rendering/ssg.md)
- Portfolio: [Portfolio Site](https://github.com/veryfrontjs/veryfront/tree/main/examples)

### Build an App
- SaaS: [Multi-Tenant Apps](/guides/architecture/README.md)
- Dashboard: [User Dashboard](https://github.com/veryfrontjs/veryfront/tree/main/examples)
- E-commerce: [Online Store](https://github.com/veryfrontjs/veryfront/tree/main/examples)
- Social: [Social Platform](https://github.com/veryfrontjs/veryfront/tree/main/examples)

### Add Features
- Auth: [Authentication](https://github.com/veryfrontjs/veryfront/tree/main/examples/auth-app)
- Search: [Full-Text Search](/reference/functions/get-server-data.md)
- Real-Time: [WebSockets & SSE](/guides/routing/api-routes.md)
- Payments: [Payment Integration](https://github.com/veryfrontjs/veryfront/tree/main/examples)

### Optimize
- Speed: [Performance Guide](/guides/performance/README.md)
- SEO: [SEO Optimization](/guides/components/head.md)
- Scale: [Scaling Guide](/guides/performance/README.md)
- Cost: [Cost Optimization](/guides/performance/README.md)

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
1. [Quick Start](/learn/quickstart.md) - 5-minute setup
2. [Rendering Comparison](/guides/rendering/comparison.md) - Choose rendering mode
3. [Deno Deployment](./deployment/deno.md) - Deploy to production
4. [Authentication](https://github.com/veryfrontjs/veryfront/tree/main/examples/auth-app) - Add user auth
5. [Performance Guide](/guides/performance/README.md) - Optimize everything

### Most Useful Patterns
1. [Data Fetching Patterns](/reference/functions/get-server-data.md) - Server & client data
2. [Error Handling](/reference/functions/not-found.md) - Handle errors gracefully
3. [Caching Strategies](/guides/performance/caching.md) - Cache effectively
4. [State Management](/guides/components/README.md) - Manage client state
5. [Testing Patterns](/guides/testing/README.md) - Test your app

### Essential Reading
- **Before Starting:** [Introduction](/learn/introduction.md) + [Quick Start](/learn/quickstart.md)
- **Before Production:** [Deployment Guide](./deployment/deno.md) + [Security](/guides/middleware/README.md)
- **Before Scaling:** [Performance](/guides/performance/README.md) + [Monitoring](/guides/deployment/README.md)

## Related Documentation

- **[API Reference](/reference/functions/README.md)** - Complete API documentation
- **[Routing System](/guides/routing/README.md)** - File-based routing
- **[Rendering Modes](/guides/rendering/README.md)** - Five rendering strategies
- **[AI System](../ai/README.md)** - AI integration guide

## Getting Help

- **Examples:** Check `/examples/` directory for working code
- **Documentation:** Browse all docs at [docs.veryfront.com](/)
- **Issues:** Report bugs and request features on GitHub
- **Community:** Join discussions and get help

## What's Next?

Choose your path:

1. **New to Veryfront?** → [Quick Start](/learn/quickstart.md)
2. **Building a site?** → [Building a Blog](https://github.com/veryfrontjs/veryfront/tree/main/examples/basic-mdx)
3. **Building an app?** → [Authentication](https://github.com/veryfrontjs/veryfront/tree/main/examples/auth-app)
4. **Adding AI?** → [AI Getting Started](../ai/getting-started.md)
5. **Deploying?** → [Deno Deployment](./deployment/deno.md)
6. **Optimizing?** → [Performance Guide](/guides/performance/README.md)
