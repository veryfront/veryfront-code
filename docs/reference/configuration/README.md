---
title: "Configuration Reference"
category: "reference"
level: "reference"
keywords: ["configuration", "config", "veryfront.config.ts", "settings", "options"]
ai_summary: "Complete configuration reference for veryfront.config.ts including all options, types, defaults, and examples"
related: ["reference/cli", "api/README", "getting-started/installation"]
version: "0.1.0"
last_updated: "2025-11-22"
---

# Configuration Reference

Complete reference for `veryfront.config.ts` configuration options.

## Overview

Configure Veryfront by creating a `veryfront.config.ts` file at the root of your project. This file controls all aspects of your application including runtime behavior, rendering strategies, build settings, and AI features.

### Basic Configuration

```typescript
// veryfront.config.ts
import { defineConfig } from 'veryfront';

export default defineConfig({
  projectName: 'my-app',
  runtime: 'deno',
});
```

### TypeScript Support

The `defineConfig` helper provides full TypeScript type checking and IntelliSense:

```typescript
import type { VeryfrontConfig } from 'veryfront';

// With explicit type
const config: VeryfrontConfig = {
  projectName: 'my-app',
};

// Or use defineConfig helper (recommended)
export default defineConfig({
  projectName: 'my-app',
});
```

---

## Core Options

### projectName

- **Type:** `string`
- **Default:** Derived from `package.json` name or directory name
- **Description:** Name of your project, used in build artifacts and metadata

```typescript
export default defineConfig({
  projectName: 'my-awesome-app',
});
```

---

### runtime

- **Type:** `'deno' | 'node' | 'bun' | 'cloudflare'`
- **Default:** Auto-detected from environment
- **Description:** Target runtime environment for your application

```typescript
export default defineConfig({
  runtime: 'deno',
});
```

**Runtime-specific behavior:**
- `'deno'` - Uses Deno APIs, JSR imports, native TypeScript
- `'node'` - Uses Node.js APIs, npm packages, requires transpilation
- `'bun'` - Uses Bun APIs, optimized bundling, fastest performance
- `'cloudflare'` - Uses Workers APIs, edge runtime limitations

**Auto-detection:** If omitted, Veryfront detects the runtime from:
1. Command used (deno, node, bun)
2. Lock files present (deno.lock, package-lock.json, bun.lockb)
3. Environment variables

---

### router

- **Type:** `'app' | 'pages' | 'auto'`
- **Default:** `'auto'` (detects from directory structure)
- **Description:** Router type to use

```typescript
export default defineConfig({
  router: 'app', // Force App Router
});
```

**Router types:**
- `'app'` - Modern App Router with layouts, loading states, error boundaries
- `'pages'` - Traditional Pages Router, simpler file-based routing
- `'auto'` - Auto-detect based on whether `app/` or `pages/` directory exists

**See Also:** [App Router Guide](/guides/routing/app-router.md), [Pages Router Guide](/guides/routing/pages-router.md)

---

## Rendering Configuration

### rendering

- **Type:** `RenderingConfig`
- **Default:** `{ default: 'ssr' }`
- **Description:** Configure rendering strategy and behavior

```typescript
export default defineConfig({
  rendering: {
    default: 'ssr',
    fallback: 'ssg',
    streaming: true,
    suspense: true,
  },
});
```

#### rendering.default

- **Type:** `'ssr' | 'ssg' | 'isr' | 'jit' | 'csr'`
- **Default:** `'ssr'`
- **Description:** Default rendering mode for pages without explicit configuration

```typescript
export default defineConfig({
  rendering: {
    default: 'ssg', // Static Site Generation by default
  },
});
```

**Rendering modes:**
- `'ssr'` - Server-Side Rendering (render on every request)
- `'ssg'` - Static Site Generation (pre-render at build time)
- `'isr'` - Incremental Static Regeneration (revalidate periodically)
- `'jit'` - Just-In-Time (render once, cache forever)
- `'csr'` - Client-Side Rendering (render in browser)

**See Also:** [Rendering Modes](/guides/rendering/README.md)

#### rendering.fallback

- **Type:** `'ssr' | 'ssg' | 'csr'`
- **Default:** `'ssr'`
- **Description:** Fallback rendering mode when primary mode fails

```typescript
export default defineConfig({
  rendering: {
    default: 'ssg',
    fallback: 'ssr', // Fall back to SSR if SSG fails
  },
});
```

#### rendering.streaming

- **Type:** `boolean`
- **Default:** `true`
- **Description:** Enable React streaming SSR for faster time-to-first-byte

```typescript
export default defineConfig({
  rendering: {
    streaming: true, // Stream HTML as it's generated
  },
});
```

#### rendering.suspense

- **Type:** `boolean`
- **Default:** `true`
- **Description:** Enable React Suspense for data fetching

```typescript
export default defineConfig({
  rendering: {
    suspense: true,
  },
});
```

---

## Build Configuration

### build

- **Type:** `BuildConfig`
- **Default:** See individual options
- **Description:** Configure build process and output

```typescript
export default defineConfig({
  build: {
    outDir: '.veryfront',
    sourcemap: true,
    minify: true,
    target: 'es2020',
    splitting: true,
  },
});
```

#### build.outDir

- **Type:** `string`
- **Default:** `'.veryfront'`
- **Description:** Output directory for build artifacts

```typescript
export default defineConfig({
  build: {
    outDir: 'dist',
  },
});
```

#### build.sourcemap

- **Type:** `boolean | 'inline' | 'hidden'`
- **Default:** `false` (production), `true` (development)
- **Description:** Generate source maps for debugging

```typescript
export default defineConfig({
  build: {
    sourcemap: true,        // Generate .map files
    // sourcemap: 'inline', // Inline source maps in bundles
    // sourcemap: 'hidden', // Generate but don't reference in code
  },
});
```

#### build.minify

- **Type:** `boolean | 'terser' | 'esbuild'`
- **Default:** `true`
- **Description:** Minify JavaScript and CSS

```typescript
export default defineConfig({
  build: {
    minify: true,          // Use default minifier (esbuild)
    // minify: 'terser',   // Use Terser (slower, smaller)
    // minify: 'esbuild',  // Use esbuild (faster)
    // minify: false,      // Disable minification
  },
});
```

#### build.target

- **Type:** `string | string[]`
- **Default:** `'es2020'`
- **Description:** JavaScript target version(s)

```typescript
export default defineConfig({
  build: {
    target: 'es2022',
    // target: ['es2020', 'chrome90', 'firefox88'],
  },
});
```

#### build.splitting

- **Type:** `boolean`
- **Default:** `true`
- **Description:** Enable code splitting for smaller initial bundles

```typescript
export default defineConfig({
  build: {
    splitting: true,
  },
});
```

#### build.publicPath

- **Type:** `string`
- **Default:** `'/'`
- **Description:** Base path for static assets

```typescript
export default defineConfig({
  build: {
    publicPath: '/assets/',
  },
});
```

#### build.cssCodeSplit

- **Type:** `boolean`
- **Default:** `true`
- **Description:** Split CSS into separate files per route

```typescript
export default defineConfig({
  build: {
    cssCodeSplit: true,
  },
});
```

---

## Development Configuration

### dev

- **Type:** `DevConfig`
- **Default:** See individual options
- **Description:** Configure development server behavior

```typescript
export default defineConfig({
  dev: {
    port: 3000,
    host: 'localhost',
    hmr: true,
    open: false,
  },
});
```

#### dev.port

- **Type:** `number`
- **Default:** `3000`
- **Description:** Development server port

```typescript
export default defineConfig({
  dev: {
    port: 8080,
  },
});
```

#### dev.host

- **Type:** `string`
- **Default:** `'localhost'`
- **Description:** Host to bind development server to

```typescript
export default defineConfig({
  dev: {
    host: '0.0.0.0', // Allow network access
  },
});
```

#### dev.hmr

- **Type:** `boolean | HMRConfig`
- **Default:** `true`
- **Description:** Enable Hot Module Replacement

```typescript
export default defineConfig({
  dev: {
    hmr: true,
    // Or with custom config
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 24678,
    },
  },
});
```

#### dev.open

- **Type:** `boolean | string`
- **Default:** `false`
- **Description:** Open browser automatically on server start

```typescript
export default defineConfig({
  dev: {
    open: true,           // Open default browser
    // open: '/about',    // Open specific path
    // open: 'chrome',    // Open specific browser
  },
});
```

#### dev.https

- **Type:** `boolean | HttpsConfig`
- **Default:** `false`
- **Description:** Enable HTTPS in development

```typescript
export default defineConfig({
  dev: {
    https: true, // Self-signed certificate
    // Or with custom certificate
    https: {
      cert: './cert.pem',
      key: './key.pem',
    },
  },
});
```

---

## AI Configuration

### ai

- **Type:** `AIConfig`
- **Default:** `{ enabled: false }`
- **Description:** Configure AI features including agents, tools, and providers

```typescript
export default defineConfig({
  ai: {
    enabled: true,
    defaultProvider: 'anthropic',
    providers: {
      anthropic: {
        apiKey: getEnv('ANTHROPIC_API_KEY'),
      },
      openai: {
        apiKey: getEnv('OPENAI_API_KEY'),
      },
    },
  },
});
```

#### ai.enabled

- **Type:** `boolean`
- **Default:** `false`
- **Description:** Enable AI features

```typescript
export default defineConfig({
  ai: {
    enabled: true,
  },
});
```

#### ai.defaultProvider

- **Type:** `'anthropic' | 'openai' | 'google' | string`
- **Default:** `'anthropic'`
- **Description:** Default AI provider to use

```typescript
export default defineConfig({
  ai: {
    enabled: true,
    defaultProvider: 'openai',
  },
});
```

#### ai.providers

- **Type:** `Record<string, ProviderConfig>`
- **Default:** `{}`
- **Description:** Configuration for AI providers

```typescript
export default defineConfig({
  ai: {
    enabled: true,
    providers: {
      anthropic: {
        apiKey: getEnv('ANTHROPIC_API_KEY'),
        baseURL: 'https://api.anthropic.com',
        defaultModel: 'claude-3-5-sonnet-20241022',
      },
      openai: {
        apiKey: getEnv('OPENAI_API_KEY'),
        organization: 'org-xxxxx',
        defaultModel: 'gpt-4-turbo',
      },
      google: {
        apiKey: getEnv('GOOGLE_API_KEY'),
        defaultModel: 'gemini-pro',
      },
    },
  },
});
```

#### ai.tools

- **Type:** `ToolsConfig`
- **Default:** Auto-discover from `ai/tools/` directory
- **Description:** Configure AI tools

```typescript
export default defineConfig({
  ai: {
    enabled: true,
    tools: {
      discovery: {
        enabled: true,
        paths: ['ai/tools', 'custom/tools'],
      },
    },
  },
});
```

#### ai.agents

- **Type:** `AgentsConfig`
- **Default:** Auto-discover from `ai/agents/` directory
- **Description:** Configure AI agents

```typescript
export default defineConfig({
  ai: {
    enabled: true,
    agents: {
      discovery: {
        enabled: true,
        paths: ['ai/agents', 'custom/agents'],
      },
    },
  },
});
```

#### ai.mcp

- **Type:** `MCPConfig`
- **Default:** `{ enabled: false }`
- **Description:** Configure Model Context Protocol server

```typescript
export default defineConfig({
  ai: {
    enabled: true,
    mcp: {
      enabled: true,
      port: 3001,
      expose: ['tools', 'resources'],
    },
  },
});
```

**See Also:** [AI Specification](../../ai/specification.md)

---

## Asset Configuration

### assets

- **Type:** `AssetsConfig`
- **Default:** See individual options
- **Description:** Configure static asset handling

```typescript
export default defineConfig({
  assets: {
    publicDir: 'public',
    images: {
      formats: ['webp', 'avif'],
      quality: 80,
    },
  },
});
```

#### assets.publicDir

- **Type:** `string`
- **Default:** `'public'`
- **Description:** Directory for static assets

```typescript
export default defineConfig({
  assets: {
    publicDir: 'static',
  },
});
```

#### assets.images

- **Type:** `ImageConfig`
- **Default:** See below
- **Description:** Image optimization settings

```typescript
export default defineConfig({
  assets: {
    images: {
      formats: ['webp', 'avif', 'jpeg'],
      quality: 85,
      sizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
      domains: ['images.example.com'],
      deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
      imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    },
  },
});
```

---

## Routing Configuration

### routes

- **Type:** `RoutesConfig`
- **Default:** See individual options
- **Description:** Configure routing behavior

```typescript
export default defineConfig({
  routes: {
    trailingSlash: false,
    caseSensitive: true,
    extensions: ['.tsx', '.ts', '.jsx', '.js'],
  },
});
```

#### routes.trailingSlash

- **Type:** `boolean`
- **Default:** `false`
- **Description:** Whether URLs should have trailing slashes

```typescript
export default defineConfig({
  routes: {
    trailingSlash: true, // /about/ instead of /about
  },
});
```

#### routes.caseSensitive

- **Type:** `boolean`
- **Default:** `true`
- **Description:** Whether route matching is case-sensitive

```typescript
export default defineConfig({
  routes: {
    caseSensitive: false, // /About matches /about
  },
});
```

#### routes.extensions

- **Type:** `string[]`
- **Default:** `['.tsx', '.ts', '.jsx', '.js']`
- **Description:** File extensions for route files

```typescript
export default defineConfig({
  routes: {
    extensions: ['.tsx', '.jsx'],
  },
});
```

---

## Middleware Configuration

### middleware

- **Type:** `MiddlewareConfig`
- **Default:** `{ enabled: true }`
- **Description:** Configure middleware behavior

```typescript
export default defineConfig({
  middleware: {
    enabled: true,
    path: 'middleware.ts',
  },
});
```

#### middleware.enabled

- **Type:** `boolean`
- **Default:** `true`
- **Description:** Enable middleware support

#### middleware.path

- **Type:** `string`
- **Default:** `'middleware.ts'`
- **Description:** Path to middleware file

---

## Environment Variables

### env

- **Type:** `EnvConfig`
- **Default:** See individual options
- **Description:** Configure environment variable handling

```typescript
export default defineConfig({
  env: {
    prefix: 'PUBLIC_',
    client: ['PUBLIC_API_URL', 'PUBLIC_ANALYTICS_ID'],
  },
});
```

#### env.prefix

- **Type:** `string`
- **Default:** `'PUBLIC_'`
- **Description:** Prefix for environment variables exposed to client

```typescript
export default defineConfig({
  env: {
    prefix: 'VITE_', // Vite-style prefixing
  },
});
```

#### env.client

- **Type:** `string[]`
- **Default:** `[]`
- **Description:** Explicit list of environment variables to expose to client

```typescript
export default defineConfig({
  env: {
    client: [
      'PUBLIC_API_URL',
      'PUBLIC_ANALYTICS_ID',
      'PUBLIC_SENTRY_DSN',
    ],
  },
});
```

---

## TypeScript Configuration

### typescript

- **Type:** `TypeScriptConfig`
- **Default:** See individual options
- **Description:** Configure TypeScript behavior

```typescript
export default defineConfig({
  typescript: {
    typeCheck: true,
    include: ['**/*.ts', '**/*.tsx'],
    exclude: ['node_modules', '.veryfront'],
  },
});
```

#### typescript.typeCheck

- **Type:** `boolean`
- **Default:** `true` (development), `false` (production)
- **Description:** Enable type checking during development

```typescript
export default defineConfig({
  typescript: {
    typeCheck: false, // Disable for faster builds
  },
});
```

#### typescript.include

- **Type:** `string[]`
- **Default:** `['**/*.ts', '**/*.tsx']`
- **Description:** Glob patterns for files to include in type checking

#### typescript.exclude

- **Type:** `string[]`
- **Default:** `['node_modules', '.veryfront']`
- **Description:** Glob patterns for files to exclude from type checking

---

## Experimental Features

### experimental

- **Type:** `ExperimentalConfig`
- **Default:** All disabled
- **Description:** Enable experimental features (may change or be removed)

```typescript
export default defineConfig({
  experimental: {
    serverComponents: true,
    serverActions: true,
    reactCompiler: false,
  },
});
```

#### experimental.serverComponents

- **Type:** `boolean`
- **Default:** `false`
- **Description:** Enable React Server Components (experimental)

#### experimental.serverActions

- **Type:** `boolean`
- **Default:** `false`
- **Description:** Enable React Server Actions (experimental)

#### experimental.reactCompiler

- **Type:** `boolean`
- **Default:** `false`
- **Description:** Enable React Compiler (experimental)

---

## Complete Configuration Example

```typescript
// veryfront.config.ts
import { defineConfig } from 'veryfront';

export default defineConfig({
  // Core settings
  projectName: 'my-awesome-app',
  runtime: 'deno',
  router: 'app',

  // Rendering
  rendering: {
    default: 'ssr',
    fallback: 'ssg',
    streaming: true,
    suspense: true,
  },

  // Build configuration
  build: {
    outDir: '.veryfront',
    sourcemap: true,
    minify: true,
    target: 'es2020',
    splitting: true,
    publicPath: '/',
    cssCodeSplit: true,
  },

  // Development server
  dev: {
    port: 3000,
    host: 'localhost',
    hmr: true,
    open: false,
    https: false,
  },

  // AI features
  ai: {
    enabled: true,
    defaultProvider: 'anthropic',
    providers: {
      anthropic: {
        apiKey: getEnv('ANTHROPIC_API_KEY'),
        defaultModel: 'claude-3-5-sonnet-20241022',
      },
      openai: {
        apiKey: getEnv('OPENAI_API_KEY'),
        defaultModel: 'gpt-4-turbo',
      },
    },
    tools: {
      discovery: {
        enabled: true,
        paths: ['ai/tools'],
      },
    },
    agents: {
      discovery: {
        enabled: true,
        paths: ['ai/agents'],
      },
    },
    mcp: {
      enabled: true,
      port: 3001,
      expose: ['tools', 'resources'],
    },
  },

  // Asset handling
  assets: {
    publicDir: 'public',
    images: {
      formats: ['webp', 'avif'],
      quality: 85,
      sizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
      domains: ['images.example.com'],
    },
  },

  // Routing
  routes: {
    trailingSlash: false,
    caseSensitive: true,
    extensions: ['.tsx', '.ts', '.jsx', '.js'],
  },

  // Middleware
  middleware: {
    enabled: true,
    path: 'middleware.ts',
  },

  // Environment variables
  env: {
    prefix: 'PUBLIC_',
    client: [
      'PUBLIC_API_URL',
      'PUBLIC_ANALYTICS_ID',
    ],
  },

  // TypeScript
  typescript: {
    typeCheck: true,
    include: ['**/*.ts', '**/*.tsx'],
    exclude: ['node_modules', '.veryfront'],
  },

  // Experimental features
  experimental: {
    serverComponents: true,
    serverActions: true,
    reactCompiler: false,
  },
});
```

---

## Configuration Patterns

### Multi-Environment Configuration

```typescript
// veryfront.config.ts
import { defineConfig } from 'veryfront';

import { getEnv } from 'veryfront/platform/compat/process.ts';
const isDev = getEnv('NODE_ENV') === 'development';
const isProd = getEnv('NODE_ENV') === 'production';

export default defineConfig({
  projectName: 'my-app',

  build: {
    sourcemap: isDev,
    minify: isProd,
  },

  dev: {
    port: isDev ? 3000 : 8080,
  },
});
```

### Conditional AI Features

```typescript
// veryfront.config.ts
import { defineConfig } from 'veryfront';

const aiEnabled = getEnv('ENABLE_AI') === 'true';

export default defineConfig({
  ai: aiEnabled ? {
    enabled: true,
    providers: {
      anthropic: {
        apiKey: Deno.env.get('ANTHROPIC_API_KEY'),
      },
    },
  } : {
    enabled: false,
  },
});
```

### Runtime-Specific Configuration

```typescript
// veryfront.config.ts
import { defineConfig } from 'veryfront';

const runtime = Deno.env.get('VERYFRONT_RUNTIME') || 'deno';

export default defineConfig({
  runtime,

  build: {
    target: runtime === 'cloudflare' ? 'es2020' : 'es2022',
  },
});
```

---

## TypeScript Types

### VeryfrontConfig

```typescript
interface VeryfrontConfig {
  projectName?: string;
  runtime?: 'deno' | 'node' | 'bun' | 'cloudflare';
  router?: 'app' | 'pages' | 'auto';
  rendering?: RenderingConfig;
  build?: BuildConfig;
  dev?: DevConfig;
  ai?: AIConfig;
  assets?: AssetsConfig;
  routes?: RoutesConfig;
  middleware?: MiddlewareConfig;
  env?: EnvConfig;
  typescript?: TypeScriptConfig;
  experimental?: ExperimentalConfig;
}
```

### RenderingConfig

```typescript
interface RenderingConfig {
  default?: 'ssr' | 'ssg' | 'isr' | 'jit' | 'csr';
  fallback?: 'ssr' | 'ssg' | 'csr';
  streaming?: boolean;
  suspense?: boolean;
}
```

### BuildConfig

```typescript
interface BuildConfig {
  outDir?: string;
  sourcemap?: boolean | 'inline' | 'hidden';
  minify?: boolean | 'terser' | 'esbuild';
  target?: string | string[];
  splitting?: boolean;
  publicPath?: string;
  cssCodeSplit?: boolean;
}
```

### AIConfig

```typescript
interface AIConfig {
  enabled: boolean;
  defaultProvider?: string;
  providers?: Record<string, ProviderConfig>;
  tools?: ToolsConfig;
  agents?: AgentsConfig;
  mcp?: MCPConfig;
}

interface ProviderConfig {
  apiKey: string;
  baseURL?: string;
  defaultModel?: string;
  organization?: string;
}
```

---

## See Also

- [CLI Reference](../cli/README.md) - Command-line interface
- [API Reference](/reference/functions/README.md) - Programming APIs
- [File Conventions](../file-conventions/README.md) - Special files
- [Installation Guide](/learn/installation.md) - Setup instructions
- [Deployment Guides](../../guides/deployment/README.md) - Production deployment

---

## Configuration Validation

Veryfront validates your configuration at startup. Common errors:

### Invalid Runtime

```
Error: Invalid runtime "nodejs". Must be one of: deno, node, bun, cloudflare
```

**Fix:** Use correct runtime name:
```typescript
export default defineConfig({
  runtime: 'node', // not 'nodejs'
});
```

### Missing Required AI Config

```
Error: AI enabled but no providers configured
```

**Fix:** Add at least one provider:
```typescript
export default defineConfig({
  ai: {
    enabled: true,
    providers: {
      anthropic: {
        apiKey: Deno.env.get('ANTHROPIC_API_KEY'),
      },
    },
  },
});
```

### Invalid Port

```
Error: Port must be between 1 and 65535
```

**Fix:** Use valid port number:
```typescript
export default defineConfig({
  dev: {
    port: 3000, // not 99999
  },
});
```

---

## Migration from Next.js

Veryfront config is similar to `next.config.js` but with some differences:

| Next.js | Veryfront |
|---------|-----------|
| `distDir` | `build.outDir` |
| `images` | `assets.images` |
| `env` | `env.client` |
| `reactStrictMode` | Always enabled |
| `swcMinify` | `build.minify` |

**Example migration:**

```javascript
// next.config.js
module.exports = {
  distDir: 'build',
  reactStrictMode: true,
  images: {
    domains: ['example.com'],
  },
};
```

```typescript
// veryfront.config.ts
export default defineConfig({
  build: {
    outDir: 'build',
  },
  assets: {
    images: {
      domains: ['example.com'],
    },
  },
});
```
