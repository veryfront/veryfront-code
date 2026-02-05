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
  app: { name: "My App" },
  build: { target: "es2022" },
  router: { trailingSlash: false },
  // ... other settings
});
```

**Key properties:** `app`, `build`, `cache`, `dev`, `router`, `theme`, `security`, `middleware`, etc.

## Environment Config (`EnvironmentConfig`)

System-level configuration read from environment variables. Captured as a frozen snapshot at startup.

```typescript
import { getEnvironmentConfig } from "#veryfront/config/environment-config.ts";

const env = getEnvironmentConfig();
console.log(env.apiBaseUrl); // from VERYFRONT_API_BASE_URL
console.log(env.debug); // from DEBUG
```

**Key properties:**

- Runtime: `nodeEnv`, `debug`, `ci`, `denoTesting`
- API: `apiBaseUrl`, `apiToken`, `projectSlug`
- Observability: `otelEnabled`, `otelEndpoint`, `otelServiceName`
- AI keys: `openaiApiKey`, `anthropicApiKey`, `googleApiKey`
- Network: `port`, `requestTimeoutMs`, `redisUrl`

## Runtime Config (`RuntimeConfig`)

The merged configuration used at runtime. Combines project config with environment overrides and adds runtime info.

```typescript
import { getRuntimeConfig } from "#veryfront/config";

const config = getRuntimeConfig();
console.log(config.build.target); // from VeryfrontConfig
console.log(config.runtime.isDevelopment); // computed from env
console.log(config.runtime.env.apiToken); // from EnvironmentConfig
```

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
├── define-config.ts            # defineConfig() helper
├── defaults.ts                 # Default values
├── network-defaults.ts         # Network-related defaults
├── schemas/                    # Zod schemas for validation
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
