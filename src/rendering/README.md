# Rendering Module

## Purpose

The rendering module handles server-side rendering (SSR), React Server Components (RSC), streaming, and HTML generation for delivering fast, SEO-friendly web applications.

## Scope

### 

What this module does:

- Server-Side Rendering (SSR) with React 17/18/19
- React Server Components (RSC) with streaming
- Progressive rendering with React Suspense
- Complete HTML document generation
- Layout system with nested layouts
- Render caching for performance
- Client-side hydration coordination
- Page and route resolution

### What this module does NOT do:

- HTTP server implementation (see `server/`)
- Build/bundling (see `build/`)
- Client-side routing (see `routing/client/`)
- API route handling (see `routing/api/`)

## Architecture

```
rendering/
├── orchestrator/              # Rendering orchestration
│   ├── ssr.ts                # Main SSR renderer
│   ├── types.ts              # Renderer types
│   └── config.ts             # Configuration
├── ssr/                       # SSR implementation
│   ├── renderer.ts           # React SSR engine
│   ├── component-registry.ts # Component registration
│   └── html-wrapper.ts       # HTML shell
├── rsc/                       # React Server Components
│   ├── server-renderer/      # RSC rendering
│   ├── dev-server-handler/   # Dev mode RSC
│   └── types.ts              # RSC types
├── layouts/                   # Layout system
│   ├── discovery.ts          # Layout file discovery
│   ├── compiler.ts           # Layout compilation
│   └── utils/                # Layout utilities
├── streaming/                 # Streaming SSR
│   ├── stream-renderer.ts    # Stream coordination
│   └── types.ts              # Stream types
├── cache/                     # Render caching
│   ├── render-cache.ts       # Cache implementation
│   └── types.ts              # Cache types
└── client/                    # Client-side utilities
    ├── hydration.ts          # Hydration coordination
    └── index.ts              # Client exports
```

## Key Exports

### Main Renderer

- `createRenderer(options)` - Create renderer instance
- `VeryfrontRenderer` - Main renderer class

### Layout System

- `discoverLayouts(dir)` - Find layout files
- `compileLayout(source)` - Compile layout to React
- `resolveLayoutChain(path)` - Get layout hierarchy

### Client Exports

- Hydration utilities for client-side initialization
- Client-side routing helpers

## Dependencies

### Internal

- `#veryfront/types` - TypeScript types
- `#veryfront/utils` - Utilities (logging, caching)
- `#veryfront/html` - HTML generation
- `#veryfront/module-system` - Module loading
- `#veryfront/platform` - Runtime adapters

### External

- `react` - React library (17/18/19 supported)
- `react-dom/server` - React SSR
- `react-server-dom-webpack` - RSC (optional)

## Usage Examples

### Basic SSR

```typescript
import { createRenderer } from "#veryfront/rendering";

const renderer = await createRenderer({
  projectDir: "./my-app",
  mode: "development",
  platform: "deno",
});

// Render a page
const result = await renderer.renderPage("/about", {
  request: new Request("https://example.com/about"),
});

console.log(result.html);
```

### React Server Components

```typescript
// app/page.tsx (Server Component)
import { db } from "./db";

export default async function Page() {
  // This runs on the server only
  const users = await db.users.findMany();

  return (
    <div>
      <h1>Users</h1>
      {users.map((user) => <UserCard key={user.id} user={user} />)}
    </div>
  );
}

// app/UserCard.tsx (Client Component)
"use client";

import { useState } from "react";

export function UserCard({ user }) {
  const [liked, setLiked] = useState(false);

  return (
    <div onClick={() => setLiked(!liked)}>
      {user.name} {liked && "❤️"}
    </div>
  );
}
```

### Streaming with Suspense

```typescript
import { Suspense } from "react";

async function SlowData() {
  const data = await fetchSlowData();
  return <div>{data}</div>;
}

export default function Page() {
  return (
    <div>
      <h1>Dashboard</h1>
      <Suspense fallback={<div>Loading...</div>}>
        <SlowData />
      </Suspense>
    </div>
  );
}
```

### Nested Layouts

```typescript
// app/layout.tsx (Root layout)
export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <header>My App</header>
        {children}
        <footer>© 2025</footer>
      </body>
    </html>
  );
}

// app/blog/layout.tsx (Blog layout)
export default function BlogLayout({ children }) {
  return (
    <div>
      <nav>Blog Navigation</nav>
      {children}
    </div>
  );
}

// app/blog/page.tsx
export default function BlogIndex() {
  return <h1>Blog Home</h1>;
}
```

### Render Caching

```typescript
import { createRenderer } from "#veryfront/rendering";

const renderer = await createRenderer({
  projectDir: "./my-app",
  cache: {
    enabled: true,
    strategy: "lru",
    maxSize: 1000,
    ttl: 3600_000, // 1 hour
  },
});

// First render - cached
await renderer.renderPage("/products");

// Second render - served from cache (fast!)
await renderer.renderPage("/products");
```

### Custom Renderer Options

```typescript
import { createRenderer } from "#veryfront/rendering";

const renderer = await createRenderer({
  projectDir: "./my-app",
  mode: "production",
  platform: "node",

  // SSR options
  ssr: {
    react Version: "18",
    streaming: true,
  },

  // RSC options
  rsc: {
    enabled: true,
    bundler: "esbuild",
  },

  // Cache options
  cache: {
    enabled: true,
    strategy: "lru",
  },

  // Layout options
  layouts: {
    rootLayout: "./app/layout.tsx",
    errorBoundary: "./app/error.tsx",
  },
});
```

## Rendering Modes

### SSR (Server-Side Rendering)

Traditional server rendering with client-side hydration:

```typescript
// pages/about.tsx
export default function About() {
  return <h1>About Us</h1>;
}

// Rendered on server → HTML sent to client → Hydrated
```

### RSC (React Server Components)

Server components that never ship to client:

```typescript
// app/page.tsx (Server Component)
export default async function Page() {
  const data = await db.query(); // Runs on server only
  return <ClientComponent data={data} />;
}
```

### Streaming

Progressive rendering with Suspense:

```typescript
export default function Page() {
  return (
    <>
      <Header /> {/* Sent immediately */}
      <Suspense fallback={<Spinner />}>
        <SlowContent /> {/* Streamed when ready */}
      </Suspense>
    </>
  );
}
```

## Performance

### Render Times (Typical Page)

- SSR (no cache): ~50-200ms
- SSR (cached): ~1-5ms
- RSC (streaming): First byte in ~10-30ms
- Streaming chunks: ~50-100ms per chunk

### Optimization Strategies

1. **Enable caching**: Cache rendered pages
2. **Use streaming**: Stream expensive components
3. **Minimize layouts**: Fewer nested layouts = faster
4. **Code splitting**: Lazy load client components

## Testing

```bash
# Run rendering tests
deno task test src/rendering/

# Test SSR
deno task test src/rendering/ssr/

# Test RSC
deno task test src/rendering/rsc/

# Test layouts
deno task test src/rendering/layouts/
```

## Maintainer

**Team:** Rendering Team
**Code Owners:** See CODEOWNERS file

## Related Modules

- [`html/`](../html/README.md) - HTML document generation
- [`build/`](../build/README.md) - Build and bundling
- [`server/`](../server/README.md) - HTTP server
- [`routing/`](../routing/README.md) - Route matching

## Troubleshooting

### Hydration Mismatches

```typescript
// Problem: Server and client render differently
export default function Page() {
  const timestamp = Date.now(); // Different on server/client!
  return <div>{timestamp}</div>;
}

// Solution: Use useEffect for client-only values
export default function Page() {
  const [timestamp, setTimestamp] = useState(null);

  useEffect(() => {
    setTimestamp(Date.now());
  }, []);

  return <div>{timestamp || "Loading..."}</div>;
}
```

### React Version Conflicts

```bash
# Check React version
deno eval "import React from 'react'; console.log(React.version)"

# Veryfront supports React 17, 18, and 19
```

### Streaming Errors

```typescript
// Problem: Streaming fails silently
const result = await renderer.renderPage("/page");

// Solution: Check for stream errors
if (result.streamError) {
  console.error("Stream error:", result.streamError);
}
```

### Layout Not Found

```bash
# Check layout discovery
deno run --allow-read check-layouts.ts

# Layouts must be named:
# - layout.tsx, layout.jsx
# - template.tsx, template.jsx
# - error.tsx, error.jsx
```

## References

- [React Server Components](https://react.dev/reference/rsc/server-components)
- [React Suspense](https://react.dev/reference/react/Suspense)
- [SSR with React](https://react.dev/reference/react-dom/server)
- [Veryfront Rendering Guide](https://veryfront.com/docs/rendering)
