---
title: "Configuration"
description: "`veryfront.config.ts` options, environment variables, and runtime settings."
order: 16
---

# Configuration

`veryfront.config.ts` options, environment variables, and runtime settings.

## Config file

```ts
// veryfront.config.ts
import { defineConfig } from "veryfront";

export default defineConfig({
  title: "My App",
  description: "A Veryfront application",
});
```

`defineConfig` provides TypeScript autocompletion but doesn't transform the config — it's a pass-through for type safety.

## Options

### Project metadata

```ts
defineConfig({
  projectSlug: "my-app",         // Project identifier
  title: "My App",               // Default page title
  description: "A great app",    // Default meta description
});
```

### Directories

Override the default directory conventions:

```ts
defineConfig({
  directories: {
    app: "src/app",              // Override page/route directory
  },
});
```

### Router mode

```ts
defineConfig({
  router: "app",    // "app" (default) | "pages"
});
```

### Build

```ts
defineConfig({
  build: {
    outDir: "dist",              // Output directory
    trailingSlash: false,        // Add trailing slashes to URLs
  },
});
```

### Layout

```ts
defineConfig({
  layout: "components/layout.tsx",  // Custom layout path
  // layout: false,                 // Disable layout
});
```

### React version

```ts
defineConfig({
  react: {
    version: "19.1.1",           // Override detected React version
  },
});
```

### Experimental features

```ts
defineConfig({
  experimental: {
    rsc: true,                   // React Server Components
    precompileMDX: true,         // Pre-compile MDX at build time
  },
});
```

### AI discovery (tools, agents, skills)

Control which directories are scanned for AI primitives:

```ts
defineConfig({
  ai: {
    tools: {
      discovery: {
        enabled: true,
        paths: ["tools", "packages/shared-tools"],
      },
    },
    agents: {
      discovery: {
        enabled: true,
        paths: ["agents"],
      },
    },
    skills: {
      discovery: {
        enabled: true,
        paths: ["skills", "internal/skills"],
      },
    },
  },
});
```

Notes:
- `paths` are relative to your project root.
- Defaults are `tools`, `agents`, and `skills`.
- Set `enabled: false` to disable discovery for that primitive.

## Environment variables

Set environment variables in `.env` files or your deployment platform:

### Provider API keys

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GOOGLE_API_KEY` | Google AI API key |

### Local AI

| Variable | Description |
|----------|-------------|
| `VERYFRONT_DISABLE_LOCAL_AI` | Set to `1` to disable server-side local model fallback (browser fallback may still run unless `browserFallback: false` is set in `useChat`) |

### Framework

| Variable | Description |
|----------|-------------|
| `PORT` | Server port (default: 3000) |
| `NODE_ENV` | `development`, `production`, or `test` |
| `REDIS_URL` | Redis connection URL |

### Observability

| Variable | Description |
|----------|-------------|
| `OTEL_ENABLED` | Enable OpenTelemetry tracing |
| `OTEL_ENDPOINT` | OpenTelemetry collector endpoint |
| `OTEL_SERVICE_NAME` | Service name for traces |

## Environment-based config

Use `getEnv` to read environment variables inside your config:

```ts
import { defineConfig, getEnv } from "veryfront";

const isProd = getEnv("NODE_ENV") === "production";

export default defineConfig({
  title: isProd ? "My App" : "My App (Dev)",
  build: {
    outDir: isProd ? "dist" : ".dev",
  },
});
```

## Reading config at runtime

The framework reads `veryfront.config.ts` automatically. Your config values are available to the build system and dev server. Pages and API routes access config indirectly through the features it enables (port, build output, router mode, etc.).

## Next

- [Building & Deploying](./deploying.md) — production builds and deployment
- [Head & SEO](./head-and-seo.md) — metadata and Open Graph tags

## Related

- [`veryfront` (root)](../reference/root.md) — `defineConfig`, `getConfig`
