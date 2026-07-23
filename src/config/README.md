# Configuration

The config module loads and validates project configuration, captures process-level environment
settings, and builds the runtime configuration used by Veryfront.

## Define project configuration

Place one supported config file in the project root. Veryfront checks the filenames in this order:

1. `veryfront.config.js`
2. `veryfront.config.ts`
3. `veryfront.config.mjs`

Use `defineConfig` for TypeScript inference. The helper returns the same object and does not perform
runtime validation by itself.

```ts
import { defineConfig } from "veryfront";

export default defineConfig({
  title: "My app",
  router: "app",
  app: "components/app.tsx",
  build: {
    outDir: "dist",
    trailingSlash: false,
  },
  dev: {
    port: 3000,
  },
});
```

Config files are executable modules. Treat them as trusted project code. The loader validates the
module's default export, rejects unknown top-level keys, and uses the schema-normalized result.

## Configuration layers

Veryfront has three related configuration types:

| Layer       | Type                | Source                          | Purpose                                            |
| ----------- | ------------------- | ------------------------------- | -------------------------------------------------- |
| Project     | `VeryfrontConfig`   | `veryfront.config.*`            | Project behavior and build settings                |
| Environment | `EnvironmentConfig` | Process environment             | Runtime, credentials, endpoints, and host settings |
| Runtime     | `RuntimeConfig`     | Project config plus environment | Effective config with computed runtime flags       |

Runtime creation starts with framework defaults and deep-merges the nested default sections used by
the runtime. Environment values then override the fields that have explicit environment controls:

- `VERYFRONT_PROJECT_SLUG` overrides `projectSlug`.
- `VERYFRONT_CACHE_DIR` or `VF_CACHE_DIR` overrides `cache.dir`.
- `REDIS_URL` overrides `cache.render.redisUrl`.
- A valid, explicitly set `PORT` overrides `dev.port`. Without `PORT`, the project file or project
  default remains in effect.
- Host OpenTelemetry settings control tracing and metrics routing. A project can still select its
  tracing service name outside shared proxy mode.
- An explicit project `experimental.rsc` value takes precedence over
  `VERYFRONT_EXPERIMENTAL_RSC`.

## Read runtime configuration

Framework code initializes the singleton during startup. Consumers can read it through the config
entrypoint:

```ts
import { getRuntimeConfig } from "veryfront/config";

const config = getRuntimeConfig();
console.log(config.build?.outDir);
console.log(config.runtime.isDevelopment);
```

`RuntimeConfig.runtime` contains the captured environment and the computed `isProduction`,
`isDevelopment`, `isTest`, `isCI`, and `isDebug` flags.

Runtime configuration is an immutable snapshot. If a caller supplies a mutable environment object,
Veryfront copies and freezes it before computing runtime flags so the flags and environment cannot
drift apart.

## Environment snapshots

`getEnvironmentConfig()` returns a frozen process-level snapshot. Before environment loading
finishes, it returns an uncached snapshot, so the first read after loading captures current host
values. Use `refreshEnvironmentConfig()` only when a host process intentionally changes environment
variables after initialization.

```ts
import { getEnvironmentConfig } from "veryfront/config";

const environment = getEnvironmentConfig();
console.log(environment.nodeEnv);
```

Important environment names include:

| Area          | Variables                                                                     |
| ------------- | ----------------------------------------------------------------------------- |
| Runtime       | `NODE_ENV`, `DENO_ENV`, `VERYFRONT_ENV`, `VERYFRONT_MODE`                     |
| Diagnostics   | `VERYFRONT_DEBUG`, `VERYFRONT_PERF`, `CI`, `DENO_TESTING`                     |
| API           | `VERYFRONT_API_BASE_URL`, `VERYFRONT_API_TOKEN`, `VERYFRONT_PROJECT_SLUG`     |
| Network       | `PORT`, `REQUEST_TIMEOUT_MS`, `VF_HTTP_FETCH_TIMEOUT`                         |
| Cache         | `REDIS_URL`, `VERYFRONT_CACHE_DIR`, `VF_CACHE_DIR`                            |
| OpenTelemetry | `VERYFRONT_OTEL`, `OTEL_EXPORTER_OTLP_ENDPOINT`, signal endpoints and headers |

Numeric environment values must be positive safe integers. Ports must be between 1 and 65535.
Invalid values use the documented default instead of being partially parsed.

Provider credential accessors read request-scoped environment overlays directly where supported.
The process-level environment snapshot remains isolated from project-scoped telemetry routing.

Shared proxy mode requires a valid `VERYFRONT_API_BASE_URL` that uses HTTP or HTTPS and contains no
credentials, query, or fragment. Veryfront rejects startup config when this endpoint is missing or
unsafe. Project config cannot replace the host-selected filesystem type, endpoint, or credentials
in proxy mode.

## Loader caching

Local project config and immutable virtual release config use the process cache. Concurrent reads of
the same persistent key share one load. Mutable virtual branch config and virtual config without an
exact source are loaded for each request.

Loaded configuration and its schema-owned containers are frozen before they enter the cache. Opaque
extension and custom middleware instances retain their own identity and mutability.

Virtual project config must use valid UTF-8 and must not exceed 4 MiB. Veryfront rejects invalid or
oversized source before importing it.

Temporary config modules resolve the supported `veryfront` authoring helpers through an isolated
local package. Veryfront uses module-lexer positions for exact static specifiers and does not scan or
rewrite strings, comments, template text, or regular expressions.

Node and compiled Deno transpile TypeScript config source before importing the isolated module. Bun
uses its native TypeScript module support.

`clearConfigCache()` invalidates cached entries and loads already in progress cannot repopulate the
new cache revision.

```ts
import { clearConfigCache } from "veryfront/config";

clearConfigCache();
```

## Public and internal entrypoints

- Use `veryfront` for project authoring helpers such as `defineConfig`.
- Use `veryfront/config` for supported config loading, validation, environment, and runtime APIs.
- Framework source uses `#veryfront/config` and narrower internal modules when it needs internal
  defaults or test utilities.

Test utilities such as `createTestEnvironmentConfig`, `_setEnvironmentConfigForTesting`, and reset
helpers are intentionally available only from their internal source modules.
