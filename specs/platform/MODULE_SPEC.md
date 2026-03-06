# NLSpec: src/platform/

## Purpose

The platform module is the cross-runtime abstraction layer for Veryfront. It provides unified APIs that work identically across Deno, Node.js, Bun, and Cloudflare Workers for process management, filesystem operations, environment variables, HTTP serving, KV storage, path manipulation, stdin/stdout, terminal colors, esbuild integration, and runtime detection. It consists of two major subsystems: **compat** (low-level cross-runtime shims that paper over API differences) and **adapters** (higher-level pluggable adapter pattern for filesystem, token storage, Redis, and runtime lifecycle management). A third small subsystem, **polyfills**, provides browser-side no-op replacements for Node.js built-ins.

## Public API

### Exports (from `src/platform/index.ts`)

| Export | Type | Description |
|--------|------|-------------|
| `getAdapter` | `() => Promise<RuntimeAdapter>` | Deprecated factory that creates a new adapter per call |
| `getLocalAdapter` | `() => Promise<RuntimeAdapter>` | Get/create a local registry singleton adapter |
| `runtime` | `AdapterRegistry` | Singleton adapter registry with `get()`, `set()`, `getSync()`, `reset()` |
| `createMockAdapter` | `() => MockRuntimeAdapter` | In-memory mock adapter for testing |
| `RuntimeAdapter` | type | Core adapter interface (fs, env, server, shell, kv, watcher) |
| `chdir`, `cwd`, `env`, `exit`, `getArgs`, `getEnv`, ... | functions | Cross-runtime process/env utilities |
| `createFileSystem`, `exists`, `mkdir`, `readDir`, `readTextFile`, `remove`, `writeTextFile` | functions | Cross-runtime filesystem operations |
| `createEscapeBuffer`, `getStdinReader`, `setRawMode` | functions | Cross-runtime stdin utilities |
| `createKVStore`, `MemoryKv` | function/class | Key-value store factory + in-memory adapter |
| `isDeno` | `boolean` | Runtime detection constant |
| `createFSAdapter`, `VeryfrontFSAdapter` | function/class | Remote filesystem adapter for Veryfront API |
| `VeryfrontApiClient` | class | HTTP client for Veryfront API (files, projects, domains) |

### Exports (from `src/platform/compat/index.ts` - extended surface)

| Export | Type | Description |
|--------|------|-------------|
| `isBun`, `isNode`, `isCloudflare`, `isDenoCompiled` | boolean constants | Runtime detection |
| `isServerEnvironment`, `isBrowserEnvironment` | functions | SSR vs browser detection |
| `deleteEnv`, `getEnvBoolean`, `getEnvNumber`, `getEnvString` | functions | Typed env access |
| `pid`, `memoryUsage`, `uptime`, `execPath`, `unrefTimer` | functions | Process info |
| `onSignal`, `onGlobalError` | functions | Signal/error handlers |
| `writeStdout`, `writeStdoutAsync`, `promptSync`, `readStdinByteSync` | functions | I/O |
| `runCommand` | function | Cross-runtime command execution with timeout |
| `dynamicImport` | function | Opaque dynamic import hidden from static analysis |
| `importKreuzberg`, `importTransformers`, `importClaudeAgentSDK` | functions | Lazy heavy-dep loaders |
| `join`, `dirname`, `basename`, `extname`, `resolve`, `relative`, `isAbsolute`, `fromFileUrl`, `sep` | functions/const | Cross-runtime path operations |
| `stat`, `symlink`, `writeFile`, `readFile`, `makeTempDir`, `isNotFoundError` | functions | Extended filesystem ops |
| `waitForKeypress`, `waitForEnterOrExit` | functions | Interactive stdin utilities |
| `openKv`, `polyfillDenoKv`, `SqliteKv` | function/class | KV store SQLite adapter + polyfill |

### Exports (from `src/platform/adapters/index.ts` - full adapter surface)

| Export | Type | Description |
|--------|------|-------------|
| `DenoAdapter`, `NodeAdapter`, `BunAdapter` | classes | Runtime-specific adapter implementations |
| `detectRuntime` | function | Returns `RuntimeId` for current environment |
| `FSAdapterWrapper`, `wrapFSAdapter`, `isExtendedFSAdapter` | class/functions | Wrap FSAdapter into RuntimeAdapter-compatible interface |
| `GitHubFSAdapter`, `MultiProjectFSAdapter`, `ProxyFSAdapterManager` | classes | Remote FS adapters (GitHub API, multi-tenant) |
| `VeryfrontTokenAdapter`, `MemoryTokenAdapter`, `createTokenStorageAdapter` | classes/function | Token persistence adapters |
| `DenoRedisAdapter`, `NodeRedisAdapter`, `getRedisModule` | classes/function | Redis client adapters |
| `withFallback`, `withFallbackSync`, `createAdapterFallback` | functions | Primary/fallback execution pattern |
| `CloudflareAdapter`, `createWorker` | class/function | Cloudflare Workers adapter |
| `security` | namespace | Re-exports sandbox and permission system |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `#veryfront/utils` | internal | Logger, path security constants |
| `#veryfront/errors/veryfront-error.ts` | internal | Structured error creation |
| `#veryfront/observability/tracing/otlp-setup.ts` | internal | `withSpan` for distributed tracing |
| `#veryfront/testing/*` | internal | Test helpers (assert, bdd, timing) |
| `esbuild` | npm | JSX/TypeScript transform |
| `mime-types` | npm | MIME type detection |
| `better-sqlite3` | npm (optional) | SQLite-backed KV store |
| `gray-matter` | npm | Front matter parsing (shim) |
| `picocolors` | npm | Terminal colors (Node.js shim) |
| `@kreuzberg/wasm` | npm | Document extraction (Deno) |

## Behaviors

### Behavior 1: Runtime Detection

- **Given**: Code running in any JavaScript runtime
- **When**: `isDeno`, `isNode`, `isBun`, `isCloudflare` constants are accessed
- **Then**: Exactly one returns `true` based on runtime globals (`Deno.version`, `process.versions.node`, `Bun`, `WebSocketPair`)
- **Edge cases**: Bun has `process.versions.node`, so Bun check runs first; dnt shims create fake Deno globals, detected via `Deno.build.os`

### Behavior 2: Adapter Registry Singleton

- **Given**: The `runtime` singleton registry
- **When**: `runtime.get()` is called for the first time
- **Then**: Detects runtime, dynamically imports the matching adapter module, calls `adapter.initialize()`, caches the instance
- **Edge cases**: Concurrent `get()` calls share the same initialization promise; Cloudflare requires manual `runtime.set()`; failed initialization clears state for retry

### Behavior 3: Cross-Runtime Process/Env

- **Given**: Any supported runtime
- **When**: `getEnv(key)` is called
- **Then**: Checks per-request project env overlay (AsyncLocalStorage) first, falls back to host env (`Deno.env.get` / `process.env`), returns `undefined` if project overlay is active and key not found (prevents host secret leakage)
- **Edge cases**: `getEnvBoolean` normalizes case and whitespace, supports custom true/false value lists

### Behavior 4: Cross-Runtime Filesystem

- **Given**: `createFileSystem()` returns a `DenoFileSystem` or `NodeFileSystem`
- **When**: Operations like `readTextFile`, `writeTextFile`, `exists`, `stat` are called
- **Then**: Delegates to runtime-specific APIs (`Deno.readTextFile` vs `fs.readFile`)
- **Edge cases**: `NodeFileSystem` lazily imports `node:fs/promises` on first use; `chmod` silently ignores errors on Windows

### Behavior 5: Command Execution with Timeout

- **Given**: `runCommand(cmd, { timeoutMs, capture, shell })` is called
- **When**: The command runs
- **Then**: Spawns process via runtime-specific API (Deno.Command / Bun.spawn / node child_process), optionally captures stdout/stderr, enforces timeout with SIGTERM then SIGKILL after grace period
- **Edge cases**: Windows uses `cmd /c` for shell mode; returns exit code 124 on timeout; Node.js uses event-based stream reading

### Behavior 6: Remote Filesystem Adapters

- **Given**: A `VeryfrontFSAdapter` or `GitHubFSAdapter` configured with API credentials
- **When**: `readFile`, `readDir`, `stat`, `exists` are called
- **Then**: Makes HTTP requests to Veryfront API or GitHub API, caches results, returns data in the `FileSystemAdapter` interface format
- **Edge cases**: `MultiProjectFSAdapter` supports per-request project context via AsyncLocalStorage; `FSAdapterWrapper` bridges `FSAdapter` to `FileSystemAdapter` interface; file extension resolution searches for `.tsx`, `.ts`, `.jsx`, `.js`, `.mdx`, `.md`

### Behavior 7: KV Store with Fallback Chain

- **Given**: `createKVStore()` or `openKv()` is called
- **When**: A KV store is needed
- **Then**: Tries native Deno KV first, then SQLite via better-sqlite3, finally falls back to in-memory `MemoryKv`
- **Edge cases**: `polyfillDenoKv()` installs `Deno.openKv` on non-Deno runtimes; `SqliteKv` creates table on construction

### Behavior 8: Cross-Runtime Path Operations

- **Given**: Path functions like `join`, `resolve`, `relative` are called
- **When**: Running on Node.js/Bun or Deno
- **Then**: Uses `node:path` when available (Node.js/Bun), otherwise uses pure JS implementations that handle forward/back slashes, drive letters, `..` traversal
- **Edge cases**: `fromFileUrl` handles Windows drive letter URLs; `validatePathSecurity` checks path traversal depth and forbidden patterns

### Behavior 9: Stdin Raw Mode and Keypress

- **Given**: Terminal-interactive code calls `setRawMode(true)` then reads stdin
- **When**: User types keys
- **Then**: Deno uses `Deno.stdin.setRaw()` + `readable.getReader()`; Node.js uses `process.stdin.setRawMode()` + event listeners
- **Edge cases**: `createEscapeBuffer` handles split escape sequences (ESC + `[A` arriving separately); `waitForEnterOrExit` distinguishes Enter from Ctrl+C

### Behavior 10: Platform Capabilities and Compatibility

- **Given**: `core-platform.ts` defines capabilities per platform
- **When**: `validatePlatformCompatibility(config, platform)` is called
- **Then**: Returns errors if config requires features the platform lacks (e.g., filesystem on Workers, MCP on Workers), warnings for recommendations (e.g., streaming on Workers)
- **Edge cases**: Infinity for `maxAgentSteps` on Deno/Node/Bun means no limit check

### Behavior 11: esbuild Binary Management for Compiled Binaries

- **Given**: A Deno-compiled binary needs esbuild
- **When**: `getEsbuild()` or `initializeEsbuild()` is called
- **Then**: Detects if running compiled (`isDenoCompiled`), searches VFS for esbuild binary, extracts to temp dir, sets `ESBUILD_BINARY_PATH` env var, then loads esbuild module
- **Edge cases**: `esbuild-init.ts` runs extraction at import time (CLI entry point); `esbuild.ts` runs lazily on first use; both set `process.env` for esbuild's own env reading

### Behavior 12: Fallback Wrapper Pattern

- **Given**: `withFallback(primary, fallback, options)` is called
- **When**: The primary operation throws
- **Then**: Catches the error, tries the fallback, returns its result on success
- **Edge cases**: If both fail, creates a `FALLBACK_EXHAUSTED` error with both errors as context; sync variant `withFallbackSync` available

## Constraints

- Must not import Node.js built-ins at the top level in files that run on Deno (use dynamic import)
- `dynamicImport` uses `new Function` to hide specifiers from static analysis / deno compile
- Shims directory provides Node.js-compatible replacements for Deno std library modules
- `path-helper.ts` is deprecated in favor of `path/index.ts`
- `esbuild-init.ts` has module-level side effects (must be imported early)

## Error Handling

- Runtime detection failures throw descriptive errors with supported runtime lists
- Adapter initialization failures reset state so retries are possible
- `getAdapter()` (deprecated) throws for Cloudflare (requires manual init)
- `runCommand` returns `{ success: false, code: 1 }` on Node.js when no process available
- `isNotFoundError` checks Deno.errors.NotFound, ENOENT code, and VeryfrontError slug
- Global error handlers (`onGlobalError`) prevent process crash, with explicit exit on Node.js when not handled

## Side Effects

- `runtime` is a module-level singleton (global state)
- `getFs()` caches a single FileSystem instance
- `esbuild-init.ts` runs binary extraction at import time
- `polyfillDenoKv()` mutates `globalThis.Deno`
- `deno-env.ts` shim mutates `globalThis.Deno`
- Console color modules eagerly start async color library loading
- `process.ts` caches project env getters on `globalThis`

## Performance Constraints

- Adapter lazy loading: runtime-specific adapters are dynamically imported only when needed
- KV fallback chain: tries native > SQLite > memory, logs fallback decisions
- FileSystem singleton: created once per process lifetime
- esbuild binary: extracted once to temp dir, cached between runs
- `VeryfrontApiClient` caches project data from initialization

## Invariants

- Exactly one runtime detection constant (`isDeno`, `isNode`, `isBun`) is true at any time (except `isCloudflare` which can co-exist)
- `RuntimeAdapter` always has `id`, `name`, `fs`, `env`, `server` properties
- `AdapterRegistry.get()` returns the same instance across concurrent calls
- `getEnv()` never leaks host env vars when project env overlay is active
- Path operations produce forward-slash-separated paths (even on Windows in Deno mode)
- `validatePathSecurity` rejects paths exceeding `MAX_PATH_TRAVERSAL_DEPTH` or matching `FORBIDDEN_PATH_PATTERNS`
