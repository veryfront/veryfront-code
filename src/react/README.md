# React Integration Module

## Purpose

The React integration module provides React version compatibility, framework-provided components, and server-side rendering (SSR) adapters. It acts as the bridge between React and Veryfront, supporting React 17, 18, and 19 with automatic feature detection.

## Scope

### What this module does:

- React version detection and compatibility
- Framework components (Link, Head, MDXProvider, etc.)
- Optimized image components with lazy loading
- SSR/SSG rendering adapters
- React hooks for framework features
- Component configuration for different React versions
- Live development components with HMR support

### What this module does NOT do:

- HTML document generation (see `html/`)
- Build-time bundling (see `build/`)
- Route resolution (see `routing/`)

## Architecture

```
react/
├── index.ts                # Public API exports
├── compat/                 # React version compatibility
│   ├── index.ts
│   ├── version-detector/   # Detect React version
│   │   ├── version-detector.ts
│   │   ├── feature-detector.ts
│   │   ├── compatibility-checker.ts
│   │   ├── version-parser.ts
│   │   └── types.ts
│   └── ssr-adapter/        # SSR rendering adapters
│       ├── index.ts
│       ├── string-renderer.ts   # renderToString
│       ├── stream-renderer.ts   # renderToReadableStream
│       ├── html-wrapper.ts      # Wrap in HTML
│       ├── response-builder.ts  # Build HTTP responses
│       └── types.ts
└── components/             # Framework components [has README]
    ├── index.ts
    ├── Link.tsx            # Navigation links
    ├── Head.tsx            # Meta tag management
    ├── MDXProvider.tsx     # MDX context provider
    ├── live/               # Live/HMR components
    │   ├── LiveApp.tsx
    │   ├── LiveDataProvider.tsx
    │   └── LiveLayoutComponent.tsx
    └── optimized-image/    # Optimized images
        ├── OptimizedImage.tsx
        ├── OptimizedBackgroundImage.tsx
        ├── SimpleOptimizedImage.tsx
        └── helpers.ts
```

## Key Exports

### Version Detection

- `getReactVersionInfo()` - Detect React version and features
- `checkReactCompatibility(version)` - Check version compatibility
- `detectReactFeatures()` - Detect available features

### Components

- `Link` - Client-side navigation with prefetching
- `Head` - Manage document head tags
- `MDXProvider` - MDX component context
- `OptimizedImage` - Responsive image with lazy loading
- `OptimizedBackgroundImage` - Background image optimization
- `SimpleOptimizedImage` - Simple optimized image

### SSR Adapters

- `renderToString(element)` - Synchronous SSR
- `renderToReadableStream(element)` - Streaming SSR
- `wrapInHTML(html, options)` - Wrap in HTML document
- `buildResponse(html, options)` - Build HTTP response

### Hooks

- `useMDXComponents()` - Get MDX component mapping

## Dependencies

### Internal

- `core/types` - Type definitions
- `core/utils` - Utilities
- `html/` - HTML generation

### External

- `react` - React library (17, 18, or 19)
- `react-dom/server` - SSR rendering

## Usage Examples

### React Version Detection

```typescript
import { getReactVersionInfo } from "#veryfront/react";

const info = getReactVersionInfo();

console.log(info.version); // "18.3.1"
console.log(info.major); // 18
console.log(info.supportsRSC); // false (true for React 19)
console.log(info.supportsStreaming); // true
console.log(info.hasNewJSXRuntime); // true

// Check compatibility
if (info.major < 17) {
  throw new Error("React 17+ required");
}
```

### Link Component

```typescript
import { Link } from "veryfront";

export default function Navigation() {
  return (
    <nav>
      {/* Basic link */}
      <Link href="/about">About</Link>

      {/* Link with prefetch */}
      <Link href="/products" prefetch>Products</Link>

      {/* External link */}
      <Link href="https://example.com" external>
        External Site
      </Link>

      {/* Custom styling */}
      <Link href="/contact" className="nav-link">
        Contact
      </Link>
    </nav>
  );
}
```

### Head Component

```typescript
import { Head } from "veryfront";

export default function BlogPost({ post }) {
  return (
    <>
      <Head>
        <title>{post.title} - My Blog</title>
        <meta name="description" content={post.excerpt} />
        <meta property="og:title" content={post.title} />
        <meta property="og:description" content={post.excerpt} />
        <meta property="og:image" content={post.coverImage} />
        <link rel="canonical" href={`https://myblog.com/posts/${post.slug}`} />
      </Head>

      <article>
        <h1>{post.title}</h1>
        <p>{post.content}</p>
      </article>
    </>
  );
}
```

### OptimizedImage Component

```typescript
import { OptimizedImage } from "veryfront";

export default function Gallery() {
  return (
    <div className="gallery">
      {/* Responsive image with multiple sizes */}
      <OptimizedImage
        src="/images/hero.jpg"
        alt="Hero image"
        width={1200}
        height={630}
        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
        formats={["avif", "webp", "jpg"]}
        loading="lazy"
      />

      {/* Eager loading for above-the-fold */}
      <OptimizedImage
        src="/images/logo.png"
        alt="Logo"
        width={200}
        height={100}
        loading="eager"
        priority
      />

      {/* Background image */}
      <OptimizedBackgroundImage
        src="/images/background.jpg"
        className="hero-section"
      >
        <h1>Welcome</h1>
      </OptimizedBackgroundImage>
    </div>
  );
}
```

### MDXProvider

```typescript
import { MDXProvider } from "veryfront";

// Custom components for MDX
const components = {
  h1: (props) => <h1 className="text-4xl font-bold" {...props} />,
  h2: (props) => <h2 className="text-3xl font-semibold" {...props} />,
  p: (props) => <p className="my-4" {...props} />,
  code: (props) => <code className="bg-gray-100 px-2 py-1" {...props} />,
  pre: (props) => <pre className="bg-gray-900 text-white p-4 rounded" {...props} />,
};

export default function MDXLayout({ children }) {
  return (
    <MDXProvider components={components}>
      <article className="prose">
        {children}
      </article>
    </MDXProvider>
  );
}
```

### SSR Rendering

```typescript
import { renderToReadableStream, renderToString } from "#veryfront/react/compat";
import { buildResponse, wrapInHTML } from "#veryfront/react/compat";

// String rendering (React 17/18)
const html = renderToString(<App />);
const fullHTML = wrapInHTML(html, {
  title: "My App",
  scripts: [{ src: "/client.js", type: "module" }],
});

// Streaming rendering (React 18+)
const stream = await renderToReadableStream(<App />, {
  bootstrapScripts: ["/client.js"],
  onError: (error) => console.error("Render error:", error),
});

// Build HTTP response
const response = buildResponse(html, {
  status: 200,
  headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
  },
});
```

## React Version Support

### React 17

- SSR with `renderToString`
- Classic JSX runtime
- Hooks support
- Streaming SSR
- Suspense on server
- RSC

### React 18

- SSR with `renderToString`
- Streaming SSR with `renderToReadableStream`
- New JSX runtime (`react-jsx`)
- Suspense on server
- Concurrent features
- RSC (experimental)

### React 19

- All React 18 features
- RSC (React Server Components)
- Server Actions
- Improved Suspense
- Enhanced streaming

## Performance

### Component Rendering

- Link component: ~0.1ms per render
- OptimizedImage: ~0.5ms per render (includes lazy loading setup)
- Head component: ~0.2ms per render

### Version Detection

- First detection: ~2-5ms (includes feature probing)
- Cached detection: <0.1ms
- Memory overhead: <1KB

### SSR Performance

- String rendering: ~10-50ms per page
- Streaming rendering: ~5-20ms to first byte
- HTML wrapping: ~1-2ms

## Testing

```bash
# Run React integration tests
deno task test src/react/

# Test components
deno task test src/react/components/

# Test version detection
deno task test src/react/compat/version-detector/

# Test SSR adapters
deno task test src/react/compat/ssr-adapter/
```

## Related Modules

- [`components/`](./components/README.md) - Framework components details
- [`html/`](../html/README.md) - HTML document generation
- [`rendering/`](../rendering/README.md) - Page rendering engine
- [`module-system/`](../module-system/README.md) - Component loading

## Troubleshooting

### Version Detection Issues

```typescript
import { getReactVersionInfo } from "#veryfront/react";

try {
  const info = getReactVersionInfo();
  console.log("Detected React:", info.version);
} catch (error) {
  console.error("Failed to detect React version:", error);
  // Fallback to manual configuration
}
```

### SSR Hydration Mismatch

```typescript
// Ensure same props on client and server
import { renderToString } from "#veryfront/react/compat";

const serverHTML = renderToString(<App initialData={data} />);

// Client must receive same initialData
// <script>window.__INITIAL_DATA__ = ${JSON.stringify(data)}</script>
```

### Image Optimization Not Working

```typescript
// Check if Sharp is installed for image optimization
import { OptimizedImage } from "veryfront";

<OptimizedImage
  src="/image.jpg"
  alt="Test"
  width={800}
  height={600}
  // Fallback if Sharp not available
  unoptimized={!process.env.SHARP_AVAILABLE}
/>;
```

### Link Prefetch Not Working

```typescript
import { Link } from 'veryfront'

// Ensure prefetch is enabled in config
<Link href="/page" prefetch>
  Page
</Link>

// Or disable prefetch globally in veryfront.config.ts
export default {
  prefetch: {
    enabled: false,  // Disable all prefetching
  },
}
```

## Maintainer Notes

**Team:** React Integration Team
**Stability:** Stable (v0.1.0+)
**React Version Support:** 17+ (with best-effort support for React 19)

This module provides the React integration layer - maintain compatibility across versions.
