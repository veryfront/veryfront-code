---
title: "Configuration"
description: "Override Veryfront conventions with config and environment variables."
order: 9
---

Veryfront follows convention over configuration. Start with the default
directories and runtime behavior. Add `veryfront.config.ts` when a project needs
to deviate from those conventions.

Use environment variables for secrets and deployment-specific values. The
framework reads config and environment variables automatically.

## Prerequisites

- A project created with `veryfront init` (see [Create project](../getting-started/create-project.md)).
- Write access to `veryfront.config.ts` when you need to override conventions.
- Write access to the project's `.env` file or deployment environment when you
  need secrets or deployment-specific values.

## When to use config

Use `veryfront.config.ts` for stable project choices:

- Change directory conventions.
- Select app-router or pages-router mode.
- Change build output or trailing-slash behavior.
- Add a custom layout or app wrapper.
- Tune discovery paths for agents, tools, skills, prompts, resources,
  workflows, or tasks.
- Set project-level provider or MCP defaults.

Do not add config just to mirror defaults. Keep the file small and add options
when the project has a concrete reason to deviate.

## Config file

```ts
// veryfront.config.ts
import { defineConfig } from "veryfront";

export default defineConfig({
  title: "My App",
  description: "A Veryfront application",
});
```

`defineConfig` provides TypeScript autocompletion but doesn't transform the
config. It is a pass-through for type safety.

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

### Remote module hosts

Use `security.remoteHosts` to allow API route source to import modules from
specific remote origins:

```ts
defineConfig({
  security: {
    remoteHosts: ["https://esm.sh", "https://cdn.jsdelivr.net"],
  },
});
```

Veryfront compares URL origins, so paths in these entries do not grant a
narrower path-level permission. An omitted setting uses the framework's default
CDN origins; an explicit empty array blocks every remote module import. A policy
can contain at most 128 URLs, and each URL can contain at most 2,048 characters.
Invalid configuration is rejected rather than replaced with a more permissive
default.

### Render cache

`cache.render` selects the render-result cache and defines its logical freshness window.

```ts
defineConfig({
  cache: {
    render: {
      type: "redis",
      ttl: 300_000,
      redisUrl: "redis://127.0.0.1:6379",
      redisKeyPrefix: "my-app",
      public: {
        enabled: true,
        varyHeaders: ["accept-language"],
      },
    },
  },
});
```

| Option               | Contract                                                                                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`               | One of `memory`, `filesystem`, `kv`, or `redis`.                                                                                                                                                                            |
| `ttl`                | Positive finite milliseconds. Zero, negative, and non-finite values are rejected.                                                                                                                                           |
| `maxEntries`         | Maximum entry count for the memory store.                                                                                                                                                                                   |
| `kvPath`             | Storage path used by the KV store.                                                                                                                                                                                          |
| `redisUrl`           | Redis connection URL used by the Redis store.                                                                                                                                                                               |
| `redisKeyPrefix`     | Non-blank Redis namespace prefix. A missing trailing `:` is added automatically. The canonical prefix is at most 512 UTF-8 bytes and cannot contain control characters or overlap another registered or reserved namespace. |
| `public.enabled`     | Explicitly permits shared caching for production SSR requests. It is disabled by default; authenticated requests, cookie-bearing requests, previews, streams, and Studio variants still bypass it.                          |
| `public.varyHeaders` | Header names whose values affect public HTML. List every header read by project data hooks that can change the response. The request origin and configured query-parameter identity are included automatically.             |

Enable `public` only when the rendered route is safe for unrelated visitors to
share. This setting is a project contract: if a data hook reads a request header
that changes HTML, that header must appear in `varyHeaders`. Veryfront stores a
nonce-free canonical document and injects the current response's CSP nonce only
after the cache lookup, so nonces are never shared between requests.

For compatibility, an existing value such as `redisKeyPrefix: "my-app"` remains
valid and is canonicalized to `my-app:`. Redis entries written by older versions
with verbatim, undelimited keys are not reused after this normalization and
expire according to their existing Redis TTL.

Related cache TTL fields have separate contracts:

| Option                     | Contract                                                             |
| -------------------------- | -------------------------------------------------------------------- |
| `cache.bundleManifest.ttl` | Non-negative safe-integer milliseconds. Zero means immediate expiry. |
| `fs.veryfront.cache.ttl`   | Positive safe-integer milliseconds.                                  |
| `fs.github.cache.ttl`      | Positive safe-integer milliseconds.                                  |

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
        paths: ["skills", "team-skills"],
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
        defaultModel: "gpt-5.4-nano",
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

Set secrets and deployment-specific values in `.env` files or your deployment
platform. Keep stable project structure in `veryfront.config.ts`.

Common groups:

- **Cloud bootstrap**: `VERYFRONT_API_TOKEN`, `VERYFRONT_PROJECT_ID`,
  `VERYFRONT_PROJECT_SLUG`, and `VERYFRONT_API_URL`.
- **Agent services**: `VERYFRONT_AGENT_SERVICE_NAME`,
  `VERYFRONT_AGENT_SERVICE_URL`, `VERYFRONT_AGENT_SERVICE_KEY`,
  `VERYFRONT_AGENT_SERVICE_REGISTRATION`, and
  `VERYFRONT_AGENT_SERVICE_REGION`.
- **Provider keys**: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`,
  and provider-specific base URLs.
- **Runtime**: `PORT`, `NODE_ENV`, `REDIS_URL`, request timeouts, SSR limits,
  and `VERYFRONT_EXPERIMENTAL_RSC`.
- **Observability**: `VERYFRONT_OTEL`, `OTEL_TRACES_ENABLED`,
  `OTEL_METRICS_ENABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT`,
  `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME`, and related `OTEL_*`
  values.

In shared/proxy runtimes, observability exporter routing is platform-owned.
Project env overlays and project `veryfront.config.ts` files must not choose the
shared runtime OTLP endpoint, headers, service name, resource attributes, or
enable flags. Veryfront filters `OTEL_*` and `VERYFRONT_OTEL` from shared
runtime project env before request execution. Dedicated runtimes and local
development can use project/deployment `OTEL_*` values because they run in their
own process boundary.

Use [Providers](./providers.md) for model-provider setup. Use
[Agent service runtime](./agent-service-runtime.md) for the registration
variables used by standalone agent services.

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

## Verify it worked

After editing `veryfront.config.ts`, restart `veryfront dev`. The dev banner
prints the resolved `title`, output directory, and router mode. Set a
distinctive `title` and check that the document title in the browser matches.

For environment variables, set a temporary non-secret value such as
`VERYFRONT_CONFIG_CHECK=enabled` and read that value from a temporary API route.
Never return API tokens, provider keys, or other secrets from a route. Remove
the route and temporary value after confirming the configuration resolves.
