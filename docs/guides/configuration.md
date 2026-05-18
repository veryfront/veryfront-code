---
title: "Configuration"
description: "`veryfront.config.ts` options, environment variables, and runtime settings."
order: 3
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

`defineConfig` provides TypeScript autocompletion but doesn't transform the config: it's a pass-through for type safety.

## Options

### Project metadata

```ts
defineConfig({
  projectSlug: "my-app", // Project identifier
  title: "My App", // Default page title
  description: "A great app", // Default meta description
});
```

### Directories

Override the default directory conventions:

```ts
defineConfig({
  directories: {
    app: "src/app", // Override page/route directory
    pages: "src/pages", // Override pages-router directory
    components: ["src/components"],
    ai: "src/ai",
  },
});
```

### Router mode

```ts
defineConfig({
  router: "app", // "app" (default) | "pages"
});
```

### Build

```ts
defineConfig({
  build: {
    outDir: "dist", // Output directory
    trailingSlash: false, // Add trailing slashes to URLs
  },
});
```

### Layout

```ts
defineConfig({
  layout: "components/layout.tsx", // Custom layout path
  // layout: false,                 // Disable layout
});
```

### App wrapper

```ts
defineConfig({
  app: "components/app.tsx", // Custom app wrapper
  // app: false,                // Disable app wrapper
});
```

### React version

```ts
defineConfig({
  react: {
    version: "19.1.1", // Override detected React version
  },
});
```

### Experimental features

```ts
defineConfig({
  experimental: {
    rsc: true, // React Server Components
    precompileMDX: true, // Pre-compile MDX at build time
  },
});
```

### AI discovery

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
    prompts: {
      discovery: {
        paths: ["prompts"],
      },
    },
    resources: {
      discovery: {
        paths: ["resources"],
      },
    },
    workflows: {
      discovery: {
        paths: ["workflows"],
      },
    },
    tasks: {
      discovery: {
        paths: ["tasks"],
      },
    },
  },
});
```

Notes:

- `paths` are relative to your project root.
- Defaults are `tools`, `agents`, `skills`, `prompts`, `resources`, `workflows`, and `tasks`.
- Set `enabled: false` to disable discovery for that primitive.

### AI providers and MCP

Configure provider defaults or the app-facing MCP surface:

```ts
defineConfig({
  ai: {
    providers: {
      openai: {
        defaultModel: "gpt-4o-mini",
      },
    },
    mcp: {
      enabled: true,
      port: 3002,
      expose: ["tools", "prompts", "resources"],
    },
  },
});
```

## Environment variables

Set environment variables in `.env` files or your deployment platform:

### Veryfront Cloud bootstrap

| Variable                                        | Description                                                                                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `VERYFRONT_API_TOKEN`                           | Veryfront API token for cloud/bootstrap-aware features and agent service registration                                                    |
| `VERYFRONT_PROJECT_ID`                          | Project id used for project-scoped agent service registration                                                                            |
| `VERYFRONT_PROJECT_SLUG`                        | Project slug used by Veryfront Cloud-aware features                                                                                      |
| `VERYFRONT_API_URL`                             | Override the hosted API URL for self-hosted API deployments                                                                              |
| `VERYFRONT_AGENT_SERVICE_NAME`                  | Optional agent service name. Defaults to the nearest project manifest name, then `veryfront-agent-service`                               |
| `VERYFRONT_AGENT_SERVICE_URL`                   | Public URL for a separately deployed agent service that should register with the control plane                                           |
| `VERYFRONT_AGENT_SERVICE_KEY`                   | Optional stable key for this agent service instance. Defaults to a deterministic key derived from service name, agent id, scope, and URL |
| `VERYFRONT_AGENT_SERVICE_REGISTRATION`          | Agent service registration mode: `auto`, `enabled`, or `disabled`. Defaults to `auto`                                                    |
| `VERYFRONT_AGENT_SERVICE_HEARTBEAT_INTERVAL_MS` | Push runtime heartbeat interval in milliseconds. Defaults to `30000`                                                                     |
| `VERYFRONT_AGENT_SERVICE_REGION`                | Optional region metadata for the registered agent service                                                                                |
| `VERYFRONT_API_BASE_URL`                        | Override the REST API base URL directly                                                                                                  |
| `VERYFRONT_DEFAULT_MODEL`                       | Override the default Veryfront Cloud model                                                                                               |
| `VERYFRONT_DEFAULT_EMBEDDING_MODEL`             | Override the default Veryfront Cloud embedding model                                                                                     |
| `VERYFRONT_RAG_BACKEND`                         | Override the default RAG backend selection                                                                                               |

### Provider API keys

| Variable                       | Description                          |
| ------------------------------ | ------------------------------------ |
| `OPENAI_API_KEY`               | OpenAI API key                       |
| `OPENAI_BASE_URL`              | Custom OpenAI-compatible endpoint    |
| `ANTHROPIC_API_KEY`            | Anthropic API key                    |
| `ANTHROPIC_BASE_URL`           | Custom Anthropic-compatible endpoint |
| `GOOGLE_API_KEY`               | Google AI API key                    |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Alternate Google AI API key env name |

### Local AI

| Variable                     | Description                                                                                                                                 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `VERYFRONT_DISABLE_LOCAL_AI` | Set to `1` to disable server-side local model fallback (browser fallback may still run unless `browserFallback: false` is set in `useChat`) |

### Framework

| Variable                        | Description                            |
| ------------------------------- | -------------------------------------- |
| `PORT`                          | Server port (default: 3000)            |
| `NODE_ENV`                      | `development`, `production`, or `test` |
| `REDIS_URL`                     | Redis connection URL                   |
| `REQUEST_TIMEOUT_MS`            | Incoming HTTP request timeout          |
| `VF_HTTP_FETCH_TIMEOUT`         | Outgoing fetch timeout                 |
| `SSR_MAX_CONCURRENT_TRANSFORMS` | Concurrency limit for SSR transforms   |
| `VERYFRONT_EXPERIMENTAL_RSC`    | Force-enable RSC experimental mode     |

### Observability

| Variable                              | Description                                   |
| ------------------------------------- | --------------------------------------------- |
| `VERYFRONT_OTEL`                      | Enable Veryfront tracing and metrics defaults |
| `OTEL_TRACES_ENABLED`                 | Enable OpenTelemetry tracing explicitly       |
| `OTEL_METRICS_ENABLED`                | Enable OpenTelemetry metrics explicitly       |
| `OTEL_EXPORTER_OTLP_ENDPOINT`         | Shared OTLP collector endpoint                |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`  | Trace-specific OTLP endpoint                  |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | Metrics-specific OTLP endpoint                |
| `OTEL_SERVICE_NAME`                   | Service name for traces                       |

For runtime-specific env behavior, `veryfront/config` and the cloud bootstrap helpers resolve these values per request where needed. Prefer environment variables for secrets and deployment-specific values, and keep `veryfront.config.ts` for stable project structure and feature defaults.

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

- [Building and deploying](./deploying.md): production builds and deployment
- [Head and SEO](./head-and-seo.md): metadata and Open Graph tags

## Related

- [`veryfront` (root)](../reference/veryfront/index.md): `defineConfig`, `getConfig`
