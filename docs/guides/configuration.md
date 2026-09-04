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
- Protect application routes with declarative `security.auth`.

Do not add config just to mirror defaults. Keep the file small and add options
when the project has a concrete reason to deviate.

For application login, keep `security.auth` declarative. Veryfront supports
function-valued config for general project configuration, but hosted auth should
resolve to a static Basic, Bearer, OIDC, or trusted-proxy shape. Do not put
provider clients, token verification code, network calls, or request-specific
auth logic in `veryfront.config.ts`. See
[Application authentication](./application-auth.md).

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
    outDir: "dist", // Project-relative production output directory
    trailingSlash: false, // Add trailing slashes to URLs
    serverExternalPackages: ["knex", "@prisma/client"],
  },
});
```

For the default production preset, `build.outDir` must resolve to a child of the
project directory. Veryfront clears this directory before writing the build.
Use `veryfront build --output <dir>` when a one-off build must write outside the
project. The embedded preset does not clear its output root, so
`build.outDir` can resolve outside the project when you use
`veryfront build --preset embedded`.

Use `serverExternalPackages` for npm packages that must run only on the server,
such as database, cache, or messaging clients. Veryfront leaves these imports
external during server rendering so the runtime resolves the installed package
instead of sending it through the module CDN. If a declared package or one of
its subpaths reaches a browser transform, Veryfront stops with a
`server-only-in-client` error that names the import and source module.

When adopting this option, move shared imports behind a server-only boundary
first: for example, into server data hooks, API routes, or server components.
Declaring a package does not make it browser-safe and does not silently stub it.
Undeclared packages keep their existing browser-compatible resolution behavior;
Veryfront does not infer additional server-only packages from source code. Use
package roots only. Do not include versions or subpaths.

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

The app wrapper must stay inside the project directory, both in its configured
path and after symlinks are resolved. Absolute paths are supported only when
they point inside the project. When upgrading an existing project that uses an
external wrapper or an in-project symlink to an external file, move the wrapper
into the project and update `app` to that project-local path.

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

Layout rendering now always uses the secure ESM path. If an existing
configuration contains `experimental.esmLayouts: false`, remove that setting;
the `false` value is no longer supported. `experimental.esmLayouts: true` may
remain during migration, but is optional.

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
- Eval, task, trigger, and workflow definitions with filenames containing
  `.test.` or `.spec.` are ignored during discovery. Rename production
  definitions that use those filename segments before upgrading.
- Discovery prefers a valid default export, then falls back to valid named
  exports from the same module. A tool needs an `execute` function, an agent
  needs an agent definition, and so on. A plain helper module sitting in a
  discovery directory is not registered as a primitive.
- Discovery still **imports** every candidate file in those directories in order
  to inspect its default export, so any module-level side effects run at startup
  even when nothing is registered. Keep shared helpers outside the discovered
  directories, or narrow `paths` to the subdirectories that hold real
  definitions.

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
- **Runtime**: `PORT`, `NODE_ENV`, `REDIS_URL` (backs the SSR transform cache,
  see [SSR transform cache](#ssr-transform-cache)), request timeouts, SSR
  limits, and `VERYFRONT_EXPERIMENTAL_RSC`.
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

### Credentials and the API host

A `veryfront.json` `apiUrl`, and a `VERYFRONT_API_URL` or `VERYFRONT_API_BASE_URL`
set in a project `.env` file, point the CLI at a different API host. Both of
those files ship with a clone, so whoever wrote the repository chooses that
host. Veryfront never sends a credential you supplied yourself to a host the
repository chose: commands such as `pull`, `merge`, `deploy`, `login`, and
`whoami` refuse instead of authenticating.

To reach a self-hosted API host, pair the host and the credential from one
source:

- Put both `apiUrl` and `apiToken` in `veryfront.json`.
- Or set both `VERYFRONT_API_URL` and `VERYFRONT_API_TOKEN` in the same project
  `.env` file. A token that `$NAME` expansion copied out of your shell does not
  count as coming from the file, because the secret is still yours.
- Or confirm the host yourself: set `VERYFRONT_API_URL` in your shell for
  GraphQL commands, or set `VERYFRONT_API_BASE_URL` for REST consumers such as
  `dev`, `start`, `eval`, `styles build-artifact`, and the `vf_remote_*` tools.
  Set the variable in the CI job environment to the API endpoint, including any base path it needs.
  Any credential then applies, including a CI secret and a `veryfront login`
  session.

Naming the default `https://api.veryfront.com` needs no confirmation, in any
equivalent spelling.

In CI, set the API URL variable used by the command next to
`VERYFRONT_API_TOKEN` in the job environment whenever the project uses a
self-hosted API host, so a non-interactive run has a confirmed host. See
[Deploy from CI](./deploy-from-ci.md) for the surrounding workflow.

## SSR transform cache

Veryfront compiles every page and its local import tree before it can render on
the server. The compiled output goes in the SSR transform cache, so a route
pays that cost once instead of on every request.

### Local development

`veryfront dev` keeps the transform cache on disk in the `.cache` directory of
the project it serves, including when you pass `--project` from another
directory. A restart reuses what the previous run compiled, so only files you
changed while the server was down are recompiled. This needs no setup and no
external service.

Cache entries are keyed by the Veryfront version, the project, the file path,
and a hash of the file contents, so an edit or an upgrade produces a new key
and never reuses stale output.

Run `veryfront clean --cache` to reset the cache. Deleting the project `.cache`
directory has the same effect. Both are safe: the next request recompiles what
it needs.

Set `VERYFRONT_CACHE_DIR` to keep the cache somewhere else. Set
`VF_CACHE_BACKEND=memory` to turn disk persistence off and keep the cache in
memory for the life of the process.

### Deployed runtimes

Set `REDIS_URL` to back the SSR transform cache with Redis. Runtime instances
then share compiled output, so a new instance starts warm instead of
recompiling every route. Veryfront Cloud provides this cache for you, so
`REDIS_URL` matters only for self-hosted deployments. Self-hosting adds no
local dev requirement: `REDIS_URL` is unset by default and dev uses the disk
cache.

## Release file cache tier

A deployed runtime reaches the distributed file cache once per key per request.
Immutable release assets are held in a small process-local tier in front of it,
so a warm asset costs no round trip at all. Only release-scoped keys are held.
Branch-scoped content changes on every save and always reaches the backend.

These variables tune that tier. The defaults are chosen to be safe, and every
one of them is a bound rather than a performance dial, so raise them
deliberately.

| Variable                                  | Default    | What it bounds                                                                 |
| ----------------------------------------- | ---------- | ------------------------------------------------------------------------------ |
| `VERYFRONT_FILE_CACHE_L1_TTL_MS`          | `5000`     | How long a held entry is served without consulting the backend, up to `60000`. |
| `VERYFRONT_FILE_CACHE_L1_MAX_ENTRIES`     | `2000`     | How many entries the tier holds.                                               |
| `VERYFRONT_FILE_CACHE_L1_MAX_VALUE_BYTES` | `524288`   | The largest single value the tier holds.                                       |
| `VERYFRONT_FILE_CACHE_L1_MAX_TOTAL_BYTES` | `67108864` | Total bytes held across every project and credential.                          |

Set any of them to `0` to turn the tier off. `VERYFRONT_FILE_CACHE_L1_TTL_MS=0`
disables it outright; a zero byte or entry ceiling means nothing is ever
admitted. Values above `60000` for `VERYFRONT_FILE_CACHE_L1_TTL_MS` are clamped
to `60000`.

The TTL is worth understanding before you raise it, because it bounds two
different things:

- **Credential revocation.** A held entry is served without asking the backend,
  which is where authorization is decided. So the TTL is the longest a
  credential revoked mid-flight can keep reading release assets of a project it
  was already authorized for.
- **Cross-pod publish visibility.** A publish invalidates this tier on the
  runtime instance that received the notification, and only that one. Every
  other instance keeps serving what it already holds until those entries
  expire. So the TTL is also the longest a publish can take to become visible
  everywhere. Raising it delays publishes on instances that did not handle the
  notification.

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
