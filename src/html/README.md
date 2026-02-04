# HTML Module

## Purpose

The HTML module provides comprehensive HTML document generation and manipulation utilities for server-side rendering (SSR). It handles HTML shell generation, meta tag injection, hydration script generation, and content manipulation with proper escaping and security.

## Scope

### What this module does:

- Generate complete HTML documents from React components
- Build and inject meta tags (Open Graph, Twitter Cards, etc.)
- Generate hydration scripts for client-side React mounting
- Create development scripts (HMR, error overlay)
- Generate production scripts (optimized hydration)
- HTML content injection and manipulation
- HTML escaping and sanitization
- Detect full HTML documents vs fragments

### What this module does NOT do:

- React rendering (see `rendering/`)
- Build-time bundling (see `build/`)
- Request routing (see `routing/`)

## Architecture

```
html/
├── index.ts                    # Public API exports
├── html-shell-generator.ts     # Main HTML document generator
├── metadata-builder.ts         # Meta tag processing
├── metadata-extraction.ts      # Extract metadata from components
├── tag-generators.ts           # Generate <meta>, <link>, <script> tags
├── html-injection.ts           # Inject content into HTML
├── html-detection.ts           # Detect HTML vs fragments
├── html-escape.ts              # HTML escaping utilities
├── dev-scripts.ts              # Development-only scripts
├── hydration-script-builder/   # Hydration script generation
│   ├── index.ts
│   ├── dev-scripts.ts          # Dev hydration + HMR
│   ├── prod-scripts.ts         # Production hydration
│   ├── hydration-data-generator.ts
│   ├── dev-client-renderer.ts
│   └── types.ts
└── styles-builder/             # CSS generation
    ├── index.ts
    ├── dev-styles.ts           # Dev mode styles
    ├── production-styles.ts    # Prod mode styles
    ├── tailwind-config.ts      # Tailwind integration
    └── theme-variables.ts      # CSS custom properties
```

## Key Exports

### HTML Generation

- `wrapInHTMLShell(content, options)` - Generate complete HTML document
- `injectHTMLContent(html, content, position)` - Inject content at position
- `isFullHTMLDocument(html)` - Check if HTML vs fragment

### Metadata

- `processMetadata(metadata)` - Process and validate metadata
- `extractHTMLMetadata(html)` - Extract metadata from HTML
- `generateMetaTags(metadata)` - Generate meta tags array
- `generateLinkTags(links)` - Generate link tags

### Hydration Scripts

- `generateHydrationData(data)` - Create hydration payload
- `getDevScripts(port, hmrPort)` - Development scripts
- `getProdScripts(manifestPath)` - Production scripts

### Tag Generators

- `generateScriptTags(scripts)` - Generate script tags
- `generateStyleTags(styles)` - Generate style tags

### Utilities

- `escapeHTML(text)` - Escape HTML special characters
- `buildAttributes(attrs)` - Build HTML attribute string

## Dependencies

### Internal

- `core/types` - Type definitions
- `core/utils` - Logging and utilities

### External

- None (pure TypeScript/JavaScript)

## Usage Examples

### Generate Complete HTML Document

```typescript
import { wrapInHTMLShell } from "#veryfront/html";

const html = await wrapInHTMLShell(reactHTML, {
  title: "My Page",
  description: "Page description",
  meta: {
    "og:title": "My Page",
    "og:description": "Page description",
    "og:image": "/og-image.png",
    "twitter:card": "summary_large_image",
  },
  scripts: [
    { src: "/client.js", type: "module" },
  ],
  styles: [
    { href: "/styles.css" },
  ],
  lang: "en",
  mode: "production",
});

// Result:
// <!DOCTYPE html>
// <html lang="en">
//   <head>
//     <meta charset="utf-8">
//     <title>My Page</title>
//     <meta name="description" content="Page description">
//     <meta property="og:title" content="My Page">
//     ...
//   </head>
//   <body>
//     <div id="root">...rendered React...</div>
//     <script type="module" src="/client.js"></script>
//   </body>
// </html>
```

### Development Mode with HMR

```typescript
import { wrapInHTMLShell } from "#veryfront/html";

const html = await wrapInHTMLShell(reactHTML, {
  title: "Dev Mode",
  mode: "development",
  devServer: {
    port: 3000,
    hmrPort: 3001,
  },
  hydrationData: {
    pageProps: { data },
    componentManifest: manifestData,
  },
});

// Includes:
// - HMR WebSocket client
// - Error overlay
// - Dev-mode React hydration
// - Component manifest for hot reload
```

### Process Metadata

```typescript
import { processMetadata } from "#veryfront/html";

const processed = processMetadata({
  title: "My Page",
  description: "Description",
  openGraph: {
    title: "OG Title",
    type: "website",
    url: "https://example.com",
    images: [
      { url: "/og-image.png", width: 1200, height: 630 },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@mysite",
  },
});

// Result: { title, description, meta: {...}, links: [...] }
```

### Generate Hydration Scripts

```typescript
import { getDevScripts, getProdScripts } from "#veryfront/html";

// Development
const devScripts = getDevScripts(3000, 3001);
// Returns inline scripts for:
// - HMR WebSocket connection
// - Error overlay
// - Dev client renderer
// - Component hot reload

// Production
const prodScripts = getProdScripts("/manifest.json");
// Returns optimized scripts for:
// - React hydration
// - Component registry
// - Minimal error handling
```

### HTML Injection

```typescript
import { injectHTMLContent } from "#veryfront/html";

const html = '<html><head></head><body><div id="app"></div></body></html>';

// Inject into <head>
const withMeta = injectHTMLContent(html, '<meta name="description" content="...">', "head-end");

// Inject before </body>
const withScript = injectHTMLContent(html, '<script src="/analytics.js"></script>', "body-end");
```

### HTML Escaping

```typescript
import { buildAttributes, escapeHTML } from "#veryfront/html";

// Escape user content
const safe = escapeHTML('<script>alert("xss")</script>');
// Result: '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'

// Build attributes safely
const attrs = buildAttributes({
  id: "my-div",
  class: "container",
  "data-value": "<script>",
});
// Result: 'id="my-div" class="container" data-value="&lt;script&gt;"'
```

## HTML Generation Options

```typescript
interface HTMLGenerationOptions {
  // Basic metadata
  title?: string;
  description?: string;
  lang?: string;

  // Meta tags
  meta?: Record<string, string>;

  // Assets
  scripts?: Array<{ src: string; type?: string; async?: boolean }>;
  styles?: Array<{ href: string; media?: string }>;

  // Mode
  mode: "development" | "production";

  // Development
  devServer?: {
    port: number;
    hmrPort: number;
  };

  // Hydration
  hydrationData?: {
    pageProps: unknown;
    componentManifest?: unknown;
  };

  // Layout
  layoutData?: {
    frontmatter: Record<string, unknown>;
    nestedLayouts: Array<unknown>;
  };
}
```

## Performance

### HTML Generation

- Shell generation: ~1-2ms per page
- Meta tag processing: ~0.5ms per page
- Script injection: ~0.3ms per script

### Memory Usage

- Minimal overhead (mostly string operations)
- No caching (stateless transformations)
- Streaming-friendly design

## Security

### XSS Prevention

- All user content escaped by default
- Attribute values properly quoted
- Script content sanitized
- Meta tag values validated

### CSP Compatibility

- Inline scripts use nonces in production
- External scripts properly attributed
- Style-src policies supported

## Testing

```bash
# Run HTML tests
deno task test src/html/

# Test shell generation
deno task test src/html/html-shell-generator.test.ts

# Test metadata processing
deno task test src/html/metadata-builder.test.ts

# Test utilities
deno task test src/html/utils.test.ts
```

## Related Modules

- [`rendering/`](../rendering/README.md) - React rendering engine
- [`react/`](../react/README.md) - React components & SSR adapter
- [`server/`](../server/README.md) - HTTP server using HTML output

## Troubleshooting

### Missing Hydration Data

```typescript
// Ensure hydration data is provided
const html = await wrapInHTMLShell(reactHTML, {
  mode: "production",
  hydrationData: {
    pageProps: props, // Required for hydration
  },
});
```

### Incorrect Meta Tags

```typescript
// Use processMetadata for validation
import { processMetadata } from "#veryfront/html";

const validated = processMetadata({
  title: "My Page",
  openGraph: {
    title: "OG Title", // Will inherit from title if missing
    type: "website", // Required for OG
  },
});
```

### HMR Not Working

```typescript
// Ensure HMR port is provided in dev mode
const html = await wrapInHTMLShell(reactHTML, {
  mode: "development",
  devServer: {
    port: 3000,
    hmrPort: 3001, // Required for HMR
  },
});
```

## Maintainer Notes

**Team:** Rendering Team
**Stability:** Stable (v0.1.0+)
**Performance Critical:** Yes (runs on every SSR request)

This module is performance-critical - optimize for speed and memory efficiency.
