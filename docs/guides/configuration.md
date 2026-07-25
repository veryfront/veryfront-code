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

- Change app, pages, or component directory conventions.
- Select app-router or pages-router mode.
- Enable or disable static generation.
- Add a custom layout or app wrapper.
- Tune discovery paths for agents, tools, skills, prompts, resources,
  workflows, or tasks.
- Configure render caching, request security, imports, extensions, and
  integrations.

Do not add config just to mirror defaults. Keep the file small and add options
when the project has a concrete reason to deviate.

## Config file

```ts
// veryfront.config.ts
import { defineConfig } from "veryfront";

export default defineConfig({
  router: "app",
  build: { ssg: true },
});
```

`defineConfig` provides TypeScript autocompletion but doesn't transform the
config. It is a pass-through for type safety.

Veryfront recognizes `veryfront.config.js`, `veryfront.config.ts`, and
`veryfront.config.mjs`. If more than one exists, Veryfront selects the first in
that order: JavaScript, TypeScript, then MJS. Keep one config file in each
project to avoid ambiguity.

## Options

### Project identity

```ts
defineConfig({
  projectSlug: "my-app",
});
```

`projectSlug` identifies the project to Cloud and CLI workflows. The schema
still accepts `title` and `description` for compatibility and extension
metadata, but core rendering does not use them as document metadata. Define
page metadata through route/frontmatter APIs described in
[Head and SEO](./head-and-seo.md).

### Directories

Override the default directory conventions:

```ts
defineConfig({
  directories: {
    app: "src/app", // Override page/route directory
    pages: "src/pages", // Override pages-router directory
    components: ["src/components"],
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
    ssg: true,
  },
});
```

`build.ssg` controls static generation when the CLI does not receive an
explicit `--ssg` or `--no-ssg` flag. Choose the build output directory with
`veryfront build --output <dir>`. Compatibility fields such as
`build.outDir`, `build.trailingSlash`, and `build.esbuild` currently have no
built-in effect.

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

### CSRF customization

Production security defaults enable double-submit CSRF protection. Use
`security.csrf: true` for the default `__Host-vf_csrf` cookie and
`x-csrf-token` header, or provide bounded custom settings:

```ts
defineConfig({
  security: {
    csrf: {
      cookieName: "__Host-vf_csrf",
      headerName: "x-csrf-token",
      excludePaths: ["/webhooks/provider"],
      ttlSec: 3600,
    },
  },
});
```

Custom cookie and header names must be non-empty HTTP tokens of at most 256
characters. Exclusions are pathname-prefix grants, so each entry must be a
canonical absolute path: no scheme or host, query, fragment, protocol-relative
`//` prefix, or trailing slash. A path is at most 4,096 characters; the list is
limited to 64 paths and 16,384 characters in total. `ttlSec` must be a positive
integer.

Older configs that used spaces or separators in custom names must choose a
valid HTTP-token name. Do not mechanically remove a trailing slash from an
exclusion: `"/hooks"` also exempts descendants such as `"/hooks/child"`.
Replace a legacy value only after confirming that prefix grant is intended.
Query-specific exclusions are not supported because enforcement compares the
canonical request pathname; keep CSRF enabled and authenticate those requests
through an explicit route-specific mechanism instead.

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

For `fs.veryfront.retry`, `maxRetries` counts retries after the initial
outbound API request and accepts 0 through 9. For compatibility,
`fs.github.retry.maxRetries` retains its historical total-attempt meaning and
accepts 0 through 10; values 0 and 1 both perform one request. Each individual
outbound API request therefore receives at most 10 attempts, but one filesystem
operation can issue more than one API request. `initialDelay` and `maxDelay`
accept integer milliseconds from 0 through the portable JavaScript timer
limit, and `initialDelay` cannot exceed `maxDelay`.

File logging uses `observability.logging.file`. `maxFiles` counts the active
file and rotated files together and accepts 1 through 100. `maxSize` is the
positive byte threshold that triggers rotation; it does not allocate that
amount of memory eagerly.

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

Provider credentials and model selection belong to the provider setup
described in [Providers](./providers.md). `ai.enabled` and provider settings are
read by CLI/development diagnostics and exposed to extensions; they do not
select a runtime provider or model. `ai.mcp` is retained for compatibility but
does not start or configure the built-in MCP server.

### Compatibility-only fields

Veryfront still validates several historical or reserved fields so existing
extensions can inspect them. Core does not currently implement built-in
behavior for:

- `title`, `description`, `directories.ai`, and `theme.colors`
- `build.outDir`, `build.trailingSlash`, and `build.esbuild`
- `dev.host`, `dev.open`, and `dev.hmrPort`
- `theming`, `assetPipeline`, and `search`
- `observability.tracing` and `observability.metrics`
- `fs.local.baseDir` and `fs.memory`
- `ai.work` and `ai.mcp`
- `tailwind.plugins`, `tailwind.theme.extend`, and `tailwind.customCSS`
- `openapi.mcp`

The complete validated config is available to project extensions and
participates in render-cache identity, so removing these fields would be a
breaking change even though core does not consume them. Do not rely on a
built-in effect unless it is documented in this guide.

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
  `VERYFRONT_EXPERIMENTAL_RSC`, and trusted-proxy topology settings.
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

`VERYFRONT_TRUST_FORWARDED_HEADERS=1` is an operator-only deployment boundary,
not a project setting. Enable it only when the runtime is reachable exclusively
through a private edge that removes untrusted routing headers and supplies its
own. The exact value `1` authorizes routing-sensitive values such as
`x-forwarded-host`, `x-environment`, and `x-project-path`; other values fail
closed. A dispatch JWS proves signature authenticity but does not replace this
topology guarantee or authorize those headers.

Use [Providers](./providers.md) for model-provider setup. Use
[Agent service runtime](./agent-service-runtime.md) for the registration
variables used by standalone agent services.

## Environment-based config

Use `getEnv` to read environment variables inside your config:

```ts
import { defineConfig, getEnv } from "veryfront";

const isProd = getEnv("NODE_ENV") === "production";

export default defineConfig({
  build: {
    ssg: isProd,
  },
  dev: { port: isProd ? 3000 : 3001 },
});
```

### Shared hosted runtimes

Local development and standalone deployments load configuration as a normal
project module. Shared hosted and proxy runtimes instead interpret
`veryfront.config.js`, `veryfront.config.mjs`, and `veryfront.config.ts` as
declarative configuration. Keep hosted config to literals, static data
expressions, and the `defineConfig`, `defineConfigWithEnv`, `getEnv`, and
`mergeConfigs` helpers exported by `veryfront`.

Hosted config cannot import other modules, perform network or filesystem I/O,
use host globals, evaluate dynamic code, or install executable extensions,
custom middleware, or function-valued CORS policies. Move that behavior into
project routes or other runtime modules.

Shared hosted runtimes allow only the in-memory render cache. Hosted config can
set `cache.render.type` to `memory` and use `ttl`, `public`, and a
`maxEntries` value from 1 through 500, along with `cache.queryParams` and the
current memory-only bundle-manifest controls. It cannot set `cache.dir`, select
`filesystem`, `kv`, or `redis`, provide backend targets such as `kvPath`,
`redisUrl`, or `redisKeyPrefix`, or select an unreviewed future cache family.
The cache-family, bundle-manifest, and render-option allowlists fail closed
before project config is merged. Trusted local and standalone deployments can
use every render-cache backend documented above.

In a shared runtime, `getEnv` sees only the authenticated project's filtered
environment snapshot. It cannot read variables from the host process or
framework-owned credentials. An exact release operation that has no
authoritative environment identity receives an empty `release` snapshot rather
than inheriting production variables. Invalid or unsupported config fails the
request; Veryfront does not execute it in the host process or silently replace
it with defaults. A temporarily unavailable config evaluator returns a
retryable service error.

Automatic OpenAPI specification and documentation generation currently
requires an explicitly local project because it reads metadata from executable
route exports. In shared hosted and proxy runtimes, the generated OpenAPI
endpoints return a non-cacheable `503 Service Unavailable` until metadata
inspection is available inside the isolated project runtime.

## Reading config at runtime

The framework reads the selected config file automatically and applies the
documented core settings at their owning runtime boundaries. It does not
publish project config automatically through the process-wide
`RuntimeConfig` singleton, and pages or API routes should not use that
singleton as request-scoped project state. Extensions receive the complete
validated config through their setup context.

## Verify it worked

After editing `veryfront.config.ts`, restart `veryfront dev`. To verify the
loader and runtime path, set a non-default `dev.port`, confirm the server binds
to that port, and open a route. To verify `build.ssg`, run `veryfront build`
without an explicit SSG flag and inspect the reported static-generation result.

For environment variables, set a temporary non-secret value such as
`VERYFRONT_CONFIG_CHECK=enabled` and read that value from a temporary API route.
Never return API tokens, provider keys, or other secrets from a route. Remove
the route and temporary value after confirming the configuration resolves.
