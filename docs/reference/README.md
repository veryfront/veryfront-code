---
title: API Reference
description: Complete API reference for Veryfront framework components, functions, and hooks
category: reference
keywords: [api, reference, documentation, components, functions, hooks]
---

# API Reference

Complete API reference for Veryfront framework. Browse components, functions, hooks, and configuration options organized by category.

## Categories

### [Components](/reference/components/)

React components provided by Veryfront for building your application.

- **[Link](/reference/components/link.md)** - Client-side navigation without page reloads
- **[Head](/reference/components/head.md)** - Modify document head for SEO and metadata
- **[OptimizedImage](/reference/components/optimized-image.md)** - Optimized images with lazy loading and format conversion

### [Functions](/reference/functions/)

Server-side functions for data fetching, routing, and page generation.

- **[getServerData](/reference/functions/get-server-data.md)** - Fetch data on the server for SSR, SSG, ISR, or JIT
- **[getStaticPaths](/reference/functions/get-static-paths.md)** - Define which paths to pre-render for static generation
- **[notFound](/reference/functions/not-found.md)** - Return 404 Not Found response
- **[redirect](/reference/functions/redirect.md)** - Server-side redirect with support for 301/302

### [Hooks](/reference/hooks/)

React hooks for client-side routing and state management.

- **[useRouter](/reference/hooks/use-router.md)** - Programmatic navigation and routing
- **[usePathname](/reference/hooks/use-pathname.md)** - Get current pathname
- **[useParams](/reference/hooks/use-params.md)** - Access dynamic route parameters
- **[useSearchParams](/reference/hooks/use-search-params.md)** - Access and manipulate query parameters

### [Configuration](/reference/configuration/)

Configuration options for `veryfront.config.ts`.

- Project settings
- Runtime configuration (Deno, Node, Bun, Cloudflare)
- Rendering modes (SSR, SSG, ISR, JIT)
- Build settings

### [CLI](/reference/cli/)

Command-line interface commands for development and deployment.

- Development server
- Build commands
- Deployment tools

### [File Conventions](/reference/file-conventions/)

Special files and naming conventions in Veryfront.

- Layout files
- Loading states
- Error boundaries
- Not found pages

### [AI APIs](/reference/ai/)

AI agent system and tool definitions (Beta).

- Agent configuration
- Tool definitions
- Provider setup

## Quick Reference

### Most Used APIs

#### Navigation

```typescript
import { Link } from 'veryfront';

<Link href="/about">About</Link>
```

#### Data Fetching

```typescript
export const getServerData = async (ctx) => {
  const data = await fetchData();
  return { props: { data } };
};
```

#### Client Routing

```typescript
'use client';

import { useRouter } from 'veryfront';

const router = useRouter();
router.push('/dashboard');
```

#### SEO & Metadata

```typescript
import { Head } from 'veryfront';

<Head>
  <title>My Page</title>
  <meta name="description" content="Description" />
</Head>
```

## API Design Principles

Veryfront's API design follows these principles:

1. **Convention over Configuration** - Sensible defaults with minimal configuration required
2. **Web Standards** - Built on standard Web APIs (Request, Response, URLSearchParams, etc.)
3. **TypeScript First** - Full type safety and IntelliSense support
4. **Framework Compatibility** - Largely compatible with Next.js API patterns
5. **Performance by Default** - Optimizations built-in without extra configuration

## Type Definitions

All Veryfront types are available from the main package:

```typescript
import type {
  DataContext,
  PageProps,
  GetStaticPaths,
  APIHandler,
  VeryfrontConfig
} from 'veryfront';
```

## Version Compatibility

This documentation covers Veryfront v0.1.0. For migration guides and version-specific changes, see:

- [Migration from Next.js](/migration/)
- [Changelog](/community/changelog.md)

## Getting Help

- **Quick Start**: [5-minute quickstart guide](/learn/quickstart.md)
- **Guides**: [Step-by-step guides](/guides/)
- **Examples**: [Example projects](https://github.com/veryfrontjs/veryfront/tree/main/examples)
- **Community**: [GitHub Discussions](https://github.com/veryfront/veryfront/discussions)

## Related Documentation

- [Routing System](/guides/routing/README.md) - File-based routing and route patterns
- [Data Fetching](/reference/functions/README.md) - Data loading strategies
- [Rendering Modes](/guides/rendering/README.md) - SSR, SSG, ISR, and JIT explained
- [AI Integration](/ai/) - AI agent system documentation
