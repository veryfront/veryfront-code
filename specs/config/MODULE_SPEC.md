# NLSpec: src/config/

## Purpose

Configuration loading, validation, and runtime access for the Veryfront framework. This module resolves project config files (`veryfront.config.{js,ts,mjs}`), validates them against a Zod schema, merges user config with sensible defaults, snapshots environment variables into a frozen `EnvironmentConfig` singleton, and provides a `RuntimeConfig` that combines file-based config with runtime environment flags. It also exports network/port constants and histogram boundaries used across the platform.

## Public API

### Exports (via `index.ts` -- internal barrel)

| Export | Type | Description |
|--------|------|-------------|
| `getConfig` | `(projectDir, adapter, options?) => Promise<VeryfrontConfig>` | Load, validate, merge, and cache project config |
| `clearConfigCache` | `() => void` | Invalidate all cached configs and bump revision |
| `getCachedConfigSync` | `(projectDir) => VeryfrontConfig \| null` | Synchronous cache lookup for hot paths |
| `GetConfigOptions` | type | Options for `getConfig` (optional `cacheKey`) |
| `defineConfig` | `(config) => VeryfrontConfig` | Identity helper for type-safe config authoring |
| `getApiTokenEnv` | `(env?) => string \| undefined` | Read API token from EnvironmentConfig |
| `isCiEnv` | `(env?) => boolean` | Check if running in CI |
| `isDenoTestingEnv` | `(env?) => boolean` | Check if running in Deno test mode |
| `isRscExperimentalEnabled` | `(env?) => boolean` | Check if RSC experiment is enabled |
| `EnvironmentConfig` | type | Frozen snapshot of all environment variables |
| `getEnvironmentConfig` | `() => EnvironmentConfig` | Get or auto-init the env config singleton |
| `initEnvironmentConfig` | `() => EnvironmentConfig` | Explicitly initialize env config singleton |
| `isEnvironmentConfigInitialized` | `() => boolean` | Check if env config singleton exists |
| `createRuntimeConfig` | `(fileConfig?, env?) => RuntimeConfig` | Create a RuntimeConfig from file config + env |
| `DEFAULT_CONFIG` | `Partial<VeryfrontConfig>` | Static default config values (for RuntimeConfig) |
| `getRuntimeConfig` | `() => RuntimeConfig` | Get or auto-init the runtime config singleton |
| `initRuntimeConfig` | `(fileConfig?) => RuntimeConfig` | Explicitly initialize runtime config singleton |
| `isRuntimeConfigInitialized` | `() => boolean` | Check if runtime config singleton exists |
| `updateRuntimeConfig` | `(fileConfig) => RuntimeConfig` | Replace the runtime config singleton |
| `RuntimeConfig` | type | VeryfrontConfig + runtime flags |
| `RuntimeInfo` | type | Runtime flags (isProduction, isDevelopment, etc.) |
| `findUnknownTopLevelKeys` | `(input) => string[]` | Detect unknown top-level config keys |
| `validateVeryfrontConfig` | `(input) => VeryfrontConfig` | Validate input against Zod schema |
| `VeryfrontConfig` | type | Zod-inferred config type |
| `VeryfrontConfigInput` | type | Zod input type |
| `veryfrontConfigSchema` | `ZodObject` | The Zod schema itself |
| `DEFAULT_PORT` | `number` (3000) | Default dev server port |
| `DEFAULT_TIMEOUT_MS` | `number` (5000) | Default timeout |
| `SSR_TIMEOUT_MS` | `number` (10000) | SSR timeout |
| `SANDBOX_TIMEOUT_MS` | `number` (5000) | Sandbox timeout |
| `DEFAULT_CACHE_MAX_SIZE` | `number` (100) | Default cache max size |
| `DURATION_HISTOGRAM_BOUNDARIES_MS` | `readonly number[]` | Duration histogram buckets |
| `SIZE_HISTOGRAM_BOUNDARIES_KB` | `readonly number[]` | Size histogram buckets |
| `DEFAULT_PREFETCH_DELAY_MS` | `number` (100) | Prefetch delay |
| `DEFAULT_METRICS_COLLECT_INTERVAL_MS` | `number` (60000) | Metrics collection interval |
| `DEFAULT_REDIS_SCAN_COUNT` | `number` (100) | Redis scan count |
| `DEFAULT_REDIS_BATCH_DELETE_SIZE` | `number` (1000) | Redis batch delete size |
| `PAGE_TRANSITION_DELAY_MS` | `number` (150) | Page transition delay |
| `DefaultConfig` | type | Type of the `defaultConfig` object |
| `defaultConfig` | `DefaultConfig` | Server/timeout/cache/metrics defaults |
| `buildIpv4Url` | `(port, protocol?) => string` | Build `http://127.0.0.1:{port}` URL |
| `buildLocalhostUrl` | `(port, protocol?) => string` | Build `http://localhost:{port}` URL |
| `DEV_LOCALHOST_CSP` | object | CSP directives for dev localhost |
| `DEV_LOCALHOST_ORIGINS` | `readonly string[]` | Localhost origin strings for CORS |
| `HTTP_DEFAULTS` | object | Default HTTP port/host constants |
| `LOCALHOST` | object | Localhost hostname/IP constants |
| `LOCALHOST_URLS` | object | Pre-built localhost URL constants |
| `REDIS_DEFAULTS` | object | Default Redis connection constants |

### Exports (via `public.ts` -- user-facing)

| Export | Type | Description |
|--------|------|-------------|
| `clearConfigCache` | function | Same as above |
| `getConfig` | function | Same as above |
| `GetConfigOptions` | type | Same as above |
| `defineConfig` | function | Same as above |
| `getApiTokenEnv` | function | Same as above |
| `isCiEnv` | function | Same as above |
| `isDenoTestingEnv` | function | Same as above |
| `findUnknownTopLevelKeys` | function | Same as above |
| `validateVeryfrontConfig` | function | Same as above |
| `VeryfrontConfig` | type | Same as above |
| `VeryfrontConfigInput` | type | Same as above |
| `veryfrontConfigSchema` | Zod schema | Same as above |
| `DEFAULT_PORT` | number | Same as above |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `z` (Zod) | `zod` | Schema definition and validation |
| `extname`, `join`, `resolve` | `#veryfront/compat/path` | Path manipulation for config file lookup |
| `RuntimeAdapter` | `#veryfront/platform/adapters/base` | Abstract filesystem access |
| `isVirtualFilesystem` | `#veryfront/platform/adapters/fs/wrapper` | Detect API-backed filesystem |
| `isBun`, `isDenoCompiled` | `#veryfront/platform/compat/runtime` | Runtime detection for import strategy |
| `serverLogger`, `logger` | `#veryfront/utils/logger` | Structured logging |
| `getReactImportMap`, `REACT_DEFAULT_VERSION` | `#veryfront/utils/constants/cdn` | Default import map for React |
| `DEFAULT_CACHE_DIR` | `#veryfront/utils/constants/server` | Default cache directory path |
| `buildConfigCacheKey` | `#veryfront/cache/keys` | Cache key generation |
| `createFileSystem` | `#veryfront/platform/compat/fs` | File I/O for temp file import |
| `createError`, `toError`, `getErrorMessage` | `#veryfront/errors/veryfront-error` | Error creation and formatting |
| `CONFIG_VALIDATION_FAILED` | `#veryfront/errors/error-registry` | Structured error for config validation |
| `VeryfrontError` | `#veryfront/errors/types` | Error type checking |
| `withSpan`, `SpanNames` | `#veryfront/observability/tracing` | OpenTelemetry tracing |
| `getEnv` | `#veryfront/platform/compat/process` | Cross-runtime env var access |
| `LRUCache` | `#veryfront/utils/lru-wrapper` | Config cache storage |
| `registerLRUCache` | `#veryfront/cache/registry` | Cache monitoring registration |
| `isTruthyEnvValue` | `#veryfront/utils/constants/env` | Truthy env value parsing |
| `hasEnvLoaded` | `#veryfront/utils/env-loader` | Check if .env file has been loaded |
| `DEFAULT_PORT`, `LOCALHOST` | `#veryfront/platform/compat/constants` | Platform-specific constants |

## Behaviors

### Behavior 1: Config file loading and merging
- **Given**: A project directory and a RuntimeAdapter
- **When**: `getConfig(projectDir, adapter)` is called
- **Then**: It searches for `veryfront.config.{js,ts,mjs}` in order, loads the first found, validates it against the Zod schema, deep-merges with defaults, caches the result, and returns it
- **Edge cases**: No config file found returns fresh defaults. Virtual filesystem loads via temp file. Bun/compiled Deno strips TypeScript syntax before import. Config validation errors are re-thrown; other load errors try the next file.

### Behavior 2: Config caching
- **Given**: A config has been loaded for a project directory
- **When**: `getConfig` is called again with the same directory
- **Then**: The cached config is returned without re-loading
- **Edge cases**: `clearConfigCache()` invalidates all entries and bumps the revision counter. `getCachedConfigSync` returns `null` for uncached or stale entries.

### Behavior 3: Environment config initialization
- **Given**: The application is starting up
- **When**: `initEnvironmentConfig()` or `getEnvironmentConfig()` is called
- **Then**: All environment variables are read once, frozen into an `EnvironmentConfig` object, and cached as a singleton
- **Edge cases**: If called before `.env` file is loaded, returns an uncached snapshot with a warning. Auto-refreshes when `.env` loads later. Subsequent calls return the same frozen instance.

### Behavior 4: Runtime config creation
- **Given**: A file-based `VeryfrontConfig` and an `EnvironmentConfig`
- **When**: `createRuntimeConfig(fileConfig, env)` is called
- **Then**: File config is merged with `DEFAULT_CONFIG`, env overrides are applied (projectSlug, port, experimental.rsc, observability, cache.redisUrl), and `RuntimeInfo` flags (isProduction, isDevelopment, isTest, isCI, isDebug) are computed
- **Edge cases**: Env projectSlug overrides file config. File config `experimental.rsc` takes precedence over env via nullish coalescing.

### Behavior 5: Schema validation
- **Given**: An unknown input object
- **When**: `validateVeryfrontConfig(input)` is called
- **Then**: It validates against the Zod schema and returns the parsed config, or throws an error with field path and hint
- **Edge cases**: CORS validation provides a specific hint. Unknown top-level keys cause a separate error in `loader.ts`.

### Behavior 6: Environment accessors (env.ts)
- **Given**: An `EnvironmentConfig` (or the global singleton)
- **When**: Any accessor function (e.g., `getApiTokenEnv`, `isCiEnv`) is called
- **Then**: It returns the corresponding value from the config snapshot
- **Edge cases**: Provider env functions (`getOpenAIEnvConfig`, `getAnthropicEnvConfig`, `getGoogleGenAIEnvConfig`) read from `getEnv()` directly for per-request scoping via AsyncLocalStorage.

### Behavior 7: Config definition helpers (define-config.ts)
- **Given**: A user config object or factory function
- **When**: `defineConfig(config)` is called
- **Then**: Returns the same object (identity function for type inference)
- **Edge cases**: `defineConfigWithEnv` passes `nodeEnv` to a factory. `mergeConfigs` does shallow `Object.assign`. `validateConfig` checks port range and outDir type.

### Behavior 8: Fresh defaults per request
- **Given**: Multiple projects being served concurrently
- **When**: Config is loaded for different projects
- **Then**: Each gets a fresh copy of defaults via `createFreshDefaults()` to prevent cross-tenant mutation
- **Edge cases**: Import maps are generated fresh per call via `getDefaultImportMapForConfig()`.

## Constraints
- Do NOT change public API signatures
- Do NOT modify files outside src/config/
- Must pass: `deno fmt --check src/config/` and `deno lint src/config/` and `deno test --no-check --allow-all src/config/`

## Error Handling
- Config validation errors use `CONFIG_VALIDATION_FAILED` from the error registry (structured `VeryfrontError`)
- Schema validation errors include the field path and a human-readable hint
- CORS-specific validation adds "Expected boolean or { origin?: string }" hint
- Config load failures for one file format log a warning and try the next format
- `isConfigError` distinguishes validation errors (re-thrown) from transient load errors (retried)

## Side Effects
- `initEnvironmentConfig` / `getEnvironmentConfig` cache a frozen singleton in module state
- `initRuntimeConfig` / `getRuntimeConfig` cache a singleton in module state
- `getConfig` caches results in an LRU cache registered for monitoring
- `loadConfigFromTempFile` creates and removes temporary directories
- `warnEarlyAccess` logs a warning once if env config accessed before `.env` load

## Performance Constraints
- Config cache uses LRU with 100 max entries to bound memory
- `getCachedConfigSync` provides zero-async-overhead cache lookup for hot paths
- Config loading is wrapped in OpenTelemetry spans for observability
- `createFreshDefaults` is called per cache miss (not per request) to avoid unnecessary allocation

## Invariants
- `EnvironmentConfig` is always `Object.freeze()`d after initialization
- Cache revision monotonically increases; stale entries are never returned
- Default import maps are never shared between projects (fresh copy per merge)
- `validateVeryfrontConfig` always throws on invalid input (never returns undefined/null)
- `RuntimeConfig` always has a `.runtime` property with computed environment flags
