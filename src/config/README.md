# Config Module

This module owns project-config discovery, validation and caching, the hosted
declarative evaluation boundary, process environment snapshots, runtime-config
helpers, and shared network defaults.

## Configuration Hierarchy

| Layer                  | Type                | Source                                  | Purpose                          |
| ---------------------- | ------------------- | --------------------------------------- | -------------------------------- |
| **Project Config**     | `VeryfrontConfig`   | `veryfront.config.js`, `.ts`, or `.mjs` | Validated per-project settings   |
| **Environment Config** | `EnvironmentConfig` | Environment variables                   | Process-owned environment state  |
| **Runtime Config**     | `RuntimeConfig`     | Explicit caller input                   | Opt-in config plus runtime flags |

## Project Config (`VeryfrontConfig`)

User-defined configuration from the project root. Discovery uses one canonical
precedence order: `veryfront.config.js`, then `veryfront.config.ts`, then
`veryfront.config.mjs`.

```typescript
import { defineConfig } from "veryfront";

export default defineConfig({
  projectSlug: "my-app",
  app: "components/app.tsx",
  build: { ssg: true },
  router: "app",
});
```

### Built-in consumption contract

Schema acceptance does not by itself mean core implements behavior for a
field. The complete validated config is also passed to extensions and included
in render-cache identity, so compatibility-only fields cannot be removed as
incidental cleanup.

| Ownership                                                        | Fields                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core runtime/build                                               | `projectSlug`, `react.version`, `directories.app/pages/components`, `router`, `layout`, `app`, `experimental.esmLayouts/rsc`, `build.outDir`, `build.ssg`, `cache`, supported `dev` fields, `resolve.importMap`, `security`, `middleware.custom`, `fs.veryfront`, `fs.github`, AI primitive discovery, `client`, `styles.stylesheet`, `integrations`, `extensions`, and core `openapi` fields |
| CLI or diagnostics                                               | `experimental.precompileMDX`, `generate.preferredRouter`, `ai.enabled`, and provider API-key checks                                                                                                                                                                                                                                                                                           |
| Accepted for extension compatibility, without built-in semantics | `title`, `description`, `directories.ai`, `theme.colors`, `build.trailingSlash/esbuild`, `dev.host/open/hmrPort`, `theming`, `assetPipeline`, tracing/metrics project config, `search`, `fs.local.baseDir`, `fs.memory`, provider defaults, `ai.work`, `ai.mcp`, and `openapi.mcp`                                                                                                            |

Keep public documentation aligned with this table. Implementing a
compatibility-only field requires an owned consumer and end-to-end tests;
removing one requires an explicit deprecation or breaking-change decision.

### Stylesheet selection

`styles.stylesheet` is the provider-neutral project-relative path to the
global stylesheet. When it is omitted, runtime and build paths look for the
conventional `globals.css`; if no project stylesheet is available, the
registered `CSSProcessor` supplies its own `defaultStylesheet`.

The `styles` object accepts only `stylesheet`. The removed
`tailwind.stylesheet` path and provider-specific plugin, theme, and custom-CSS
config are rejected by the strict project schema. Compiler defaults, plugin
loading, and other vendor policy belong to the selected CSS extension rather
than Config or another core module.

In shared proxy mode (`PROXY_MODE=1`), the runtime owns the filesystem backend
and requires `VERYFRONT_API_BASE_URL` to be a credential-free HTTP(S) base URL
without a query or fragment. Project configuration must not override `fs`; an
attempted override is rejected instead of producing a mixed backend
configuration.

### Hosted configuration boundary

Local filesystems, standalone deployments, and trusted single-project virtual
filesystems preserve executable TypeScript and JavaScript configuration.
Shared multi-project runtimes use a different boundary: they read the selected
config file once from an authenticated project/source context and evaluate its
declarative subset in a bounded worker.

The hosted evaluator accepts static data plus the supported `veryfront` config
helpers. It rejects imports other than those helpers, host globals, filesystem
or network access, dynamic code, executable extensions and middleware, and
function-valued policies. The runtime validates project, source, release, and
environment identity before filesystem access. `getEnv` receives only the
filtered tenant environment snapshot prepared for that same source.

Hosted cache policy permits memory render controls but rejects `cache.dir`,
persistent or network render backends, and backend-specific targets before the
validated result reaches config merging. The render allowlist contains only
`type: "memory"`, `ttl`, `maxEntries`, and `public`; `maxEntries` cannot exceed
the production default of 500. Top-level cache families and bundle-manifest
controls are independently allowlisted, so future storage capabilities fail
closed until the hosted boundary explicitly reviews them. Trusted local and
standalone config retains the complete cache schema.

Production environment sources are bound to their exact active release.
Preview sources are bound to the selected branch and are not persisted in the
production config cache. An exact release that has no authoritative environment
identity is evaluated with the `release` label and an empty, frozen environment
snapshot; it never inherits production secrets by convention.

Hosted parse, policy, protocol, capacity, and timeout failures fail closed.
They are not retried by executing tenant configuration in the host process, and
operational file-read errors are not treated as a missing config file.

## Environment Config (`EnvironmentConfig`)

System-level configuration read from environment variables. Before environment
loading is marked complete, getters return fresh frozen snapshots so an early
read cannot permanently cache an incomplete environment. After loading,
initialization stores one frozen process-wide snapshot.

```typescript
// Internal source import; this alias is not a package subpath.
import { getEnvironmentConfig } from "#veryfront/config/environment-config.ts";

const env = getEnvironmentConfig();
console.log(env.apiBaseUrl); // from VERYFRONT_API_BASE_URL
console.log(env.debug); // from VERYFRONT_DEBUG
```

**Key properties:**

- Runtime: `nodeEnv`, `debug`, `ci`, `denoTesting`
- API: `apiBaseUrl`, `apiToken`, `projectSlug`
- Observability: `otelEnabled`, `otelEndpoint`, `otelServiceName`
- AI keys: `openaiApiKey`, `anthropicApiKey`, `googleApiKey`
- Network: `port`, `requestTimeoutMs`

## Runtime Config (`RuntimeConfig`)

An opt-in, process-local helper that combines configuration supplied by its
caller with an environment snapshot and adds runtime flags. Server bootstrap
and hosted config loading do **not** automatically publish
`veryfront.config.*` values to this singleton.

Use `createRuntimeConfig(projectConfig, env)` when you need a standalone value.
`initRuntimeConfig(projectConfig)` and `updateRuntimeConfig(projectConfig)` are
only for trusted single-tenant startup or tooling. Never put request-scoped
hosted tenant configuration in the singleton.

```typescript
// Internal source aliases are shown because this README documents the module.
import { createRuntimeConfig, getRuntimeConfig, initRuntimeConfig } from "#veryfront/config";

const standalone = createRuntimeConfig({ router: "pages" });
console.log(standalone.router); // "pages"

initRuntimeConfig({ title: "Trusted single-tenant process" });
const processConfig = getRuntimeConfig();
console.log(processConfig.runtime.isDevelopment); // computed from host env
```

Calling `getRuntimeConfig()` before explicit initialization lazily creates a
defaults-plus-host-environment singleton. It does not discover or load a
project config file.

**Structure:**

```typescript
interface RuntimeConfig extends VeryfrontConfig {
  runtime: {
    env: EnvironmentConfig;
    isDevelopment: boolean;
    isProduction: boolean;
    isTest: boolean;
    isCI: boolean;
    isDebug: boolean;
  };
}
```

## File Structure

```
src/config/
├── index.ts                    # Barrel exports
├── environment-config.ts       # EnvironmentConfig type and getters
├── runtime-config.ts           # RuntimeConfig merging logic
├── loader.ts                   # Config file loading and caching
├── config-files.ts             # Canonical filenames and discovery order
├── config-shim.ts              # Cross-runtime config helper module
├── declarative-evaluator.ts    # Hosted declarative parser/evaluator
├── declarative-evaluator-worker-*.ts
│                               # Bounded worker protocol and lifecycle
├── snapshot.ts                 # Descriptor-safe immutable snapshots
├── define-config.ts            # defineConfig() helper
├── defaults.ts                 # Default values
├── network-defaults.ts         # Network-related defaults
├── schemas/                    # Runtime schemas for validation
│   └── index.ts
├── env.ts                      # Environment accessor helpers
└── *.test.ts                   # Tests
```

## Usage Patterns

### Loading project config at an owning boundary

```typescript
import { getConfig } from "#veryfront/config";
import { runtime } from "#veryfront/platform";

const config = await getConfig(projectDir, await runtime.get());
```

These `#veryfront/*` aliases are internal source boundaries. The published
package intentionally does not export `veryfront/config` or
`veryfront/platform`.

Do not substitute the process-wide `RuntimeConfig` singleton for
request-scoped hosted project state.

### Reading environment values

```typescript
import { getEnvironmentConfig } from "#veryfront/config/environment-config.ts";

// Or use typed accessors from env.ts
import { getApiBaseUrlEnv, isDebugEnvEnabled } from "#veryfront/config/env.ts";
```

### Testing with isolated config

```typescript
import {
  _resetEnvironmentConfig,
  createTestEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";

beforeEach(() => {
  _resetEnvironmentConfig();
});

it("test with custom env", () => {
  const env = createTestEnvironmentConfig({ debug: true });
  // use env in test
});
```

The underscored reset helper and `#veryfront/*` aliases are internal test
surfaces, not package APIs.
