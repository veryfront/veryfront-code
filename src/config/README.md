# Config Module

This module manages all configuration for the Veryfront renderer.

## Configuration Hierarchy

| Layer                  | Type                | Source                | Purpose                                  |
| ---------------------- | ------------------- | --------------------- | ---------------------------------------- |
| **Project Config**     | `VeryfrontConfig`   | `veryfront.config.ts` | Per-project settings defined by the user |
| **Environment Config** | `EnvironmentConfig` | Environment variables | System-level settings from env vars      |
| **Runtime Config**     | `RuntimeConfig`     | Merged at startup     | Combined config with runtime info        |

## Project Config (`VeryfrontConfig`)

User-defined configuration from `veryfront.config.ts` in the project root.

```typescript
import { defineConfig } from "veryfront";

export default defineConfig({
  title: "My App",
  app: "components/app.tsx",
  build: { outDir: "dist", trailingSlash: false },
  router: "app",
});
```

**Key properties:** `app`, `build`, `cache`, `dev`, `router`, `theme`, `security`, `middleware`, etc.

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

Production environment sources are bound to their exact active release.
Preview sources are bound to the selected branch and are not persisted in the
production config cache. An exact release that has no authoritative environment
identity is evaluated with the `release` label and an empty, frozen environment
snapshot; it never inherits production secrets by convention.

Hosted parse, policy, protocol, capacity, and timeout failures fail closed.
They are not retried by executing tenant configuration in the host process, and
operational file-read errors are not treated as a missing config file.

## Environment Config (`EnvironmentConfig`)

System-level configuration read from environment variables. Captured as a frozen snapshot at startup.

```typescript
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
- Network: `port`, `requestTimeoutMs`, `redisUrl`

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
import { createRuntimeConfig, getRuntimeConfig, initRuntimeConfig } from "#veryfront/config";

const standalone = createRuntimeConfig({ build: { outDir: "output" } });
console.log(standalone.build?.outDir); // "output"

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
├── declarative-evaluator.ts    # Hosted declarative parser/evaluator
├── declarative-evaluator-worker-*.ts
│                               # Bounded worker protocol and lifecycle
├── define-config.ts            # defineConfig() helper
├── defaults.ts                 # Default values
├── network-defaults.ts         # Network-related defaults
├── schemas/                    # Runtime schemas for validation
│   └── index.ts
├── env.ts                      # Environment accessor helpers
└── *.test.ts                   # Tests
```

## Usage Patterns

### Reading config in application code

```typescript
import { getRuntimeConfig } from "#veryfront/config";

const config = getRuntimeConfig();
```

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
