---
title: Architecture
description: How Veryfront works - rendering, routing, and request flow
category: guides
keywords: [architecture, rendering, routing, request flow]
---

# Architecture

Understand how Veryfront processes requests and renders pages.

## Request Flow

```
Request
  ↓
Route Matching (file-based)
  ↓
API Route? → Handle and return response
Page Route? → Continue
  ↓
Data Fetching (getServerData/getStaticData)
  ↓
Rendering (SSR/SSG/ISR/JIT)
  ↓
HTML Generation
  ↓
Response
```

## Rendering Pipeline

### Server-Side Rendering (SSR)

```
Request → Match Route → Fetch Data → Render React → Stream HTML → Response
```

Each request triggers a fresh render. Use for dynamic, personalized content.

### Static Site Generation (SSG)

```
Build Time: Find Pages → Fetch Data → Render → Write HTML files
Runtime: Serve pre-built HTML
```

Pages are generated once at build time. Use for content that rarely changes.

### Incremental Static Regeneration (ISR)

```
First Request: Generate → Cache → Response
Subsequent: Serve cached (background: check revalidate → regenerate)
```

Combines SSG performance with periodic updates. Use for content updated on a schedule.

### Just-In-Time Rendering (JIT)

```
Build: Pre-render critical pages only
Runtime: Generate remaining pages on first request → Cache
```

Handles large sites (100,000+ pages) efficiently. Only builds critical pages upfront.

## Module Structure

Veryfront uses a layered architecture:

| Layer | Purpose | Examples |
|-------|---------|----------|
| **Public API** | What you import | `Link`, `Head`, `defineConfig` |
| **Framework Core** | Rendering, routing, build | SSR engine, route matcher |
| **Infrastructure** | Platform abstraction | Deno/Node/Bun adapters |

## Platform Support

Veryfront abstracts runtime differences:

```typescript
// Works identically on Deno, Node.js, Bun, Cloudflare Workers
import { Link, Head } from 'veryfront';
```

The platform layer handles:
- File system operations
- HTTP server creation
- Environment variables
- Module loading

## Related Documentation

- [Rendering Modes](../rendering/README.md) - Detailed rendering guide
- [Routing](../routing/README.md) - File-based routing system
- [Deployment](../deployment/README.md) - Platform-specific deployment
