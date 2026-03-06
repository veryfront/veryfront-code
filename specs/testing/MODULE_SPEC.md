# NLSpec: src/testing/

## Purpose

Cross-runtime test utilities that provide a unified BDD framework (describe/it/hooks),
assertion library, test isolation (env snapshots, global snapshots, timer tracking,
SSR stub cleanup), filesystem/env helpers, and timing utilities for Deno, Node.js, and
Bun. The module auto-initializes on import: `init.ts` disables LRU cache intervals and
sets env masking flags, `bdd.ts` eagerly loads the runtime-specific BDD backend, and
`assert.ts` eagerly loads the runtime-specific assertion backend.

## Public API

### Exports (via `index.ts` barrel)

| Export | Type | Source | Description |
|--------|------|--------|-------------|
| `assert` | function | assert.ts | Truthy assertion |
| `assertEquals` | function | assert.ts | Deep equality assertion |
| `assertExists` | function | assert.ts | Non-null/undefined assertion |
| `assertGreater` | function | assert.ts | Numeric greater-than |
| `assertGreaterOrEqual` | function | assert.ts | Numeric greater-or-equal |
| `assertInstanceOf` | function | assert.ts | Instance-of assertion |
| `assertLess` | function | assert.ts | Numeric less-than |
| `assertLessOrEqual` | function | assert.ts | Numeric less-or-equal |
| `assertMatch` | function | assert.ts | Regex match assertion |
| `assertNotEquals` | function | assert.ts | Deep inequality assertion |
| `assertNotStrictEquals` | function | assert.ts | Reference inequality |
| `assertObjectMatch` | function | assert.ts | Partial object match |
| `assertRejects` | function | assert.ts | Async rejection assertion |
| `assertStrictEquals` | function | assert.ts | Reference equality (===) |
| `assertStringIncludes` | function | assert.ts | Substring assertion |
| `assertThrows` | function | assert.ts | Sync throw assertion |
| `fail` | function | assert.ts | Unconditional test failure |
| `deepEquals` | function | utils.ts | Deep structural equality |
| `safeStringify` | function | utils.ts | Safe JSON.stringify wrapper |
| `describe` | function | bdd.ts | BDD suite declaration |
| `it` | function | bdd.ts | BDD test case declaration |
| `test` | function | bdd.ts | Alias for `it` |
| `beforeAll` | function | bdd.ts | Suite-level setup hook |
| `afterAll` | function | bdd.ts | Suite-level teardown hook |
| `beforeEach` | function | bdd.ts | Per-test setup hook |
| `afterEach` | function | bdd.ts | Per-test teardown hook |
| `BddTestContext` | type | bdd.ts | Context passed to hooks |
| `TestOptions` | type | bdd.ts | Options (skip, only, timeout, sanitizers) |
| `registerTestCleanup` | function | isolation.ts | Register a one-shot cleanup task |
| `resetAllTestState` | function | isolation.ts | Clear all known caches/singletons |
| `chmod` | function | deno-compat.ts (re-export) | Change file permissions |
| `createFileSystem` | function | deno-compat.ts (re-export) | Create filesystem adapter |
| `cwd` | function | deno-compat.ts (re-export) | Get current working directory |
| `delay` | function | deno-compat.ts | Promise-based delay (time-scaled) |
| `deleteEnv` | function | deno-compat.ts (re-export) | Delete environment variable |
| `env` | function | deno-compat.ts (re-export) | Read all env vars |
| `exists` | function | deno-compat.ts (re-export) | Check file existence |
| `exit` | function | deno-compat.ts | Exit the process |
| `getArgs` | function | deno-compat.ts (re-export) | Get CLI arguments |
| `getEnv` | function | deno-compat.ts (re-export) | Get single env var |
| `isAlreadyExistsError` | function | deno-compat.ts (re-export) | Error type check |
| `isNotFoundError` | function | deno-compat.ts (re-export) | Error type check |
| `makeTempDir` | function | deno-compat.ts (re-export) | Create temp directory |
| `makeTempDirWithOptions` | function | deno-compat.ts | Create temp directory (prefix/dir) |
| `makeTempFile` | function | deno-compat.ts | Create temp file |
| `mkdir` | function | deno-compat.ts (re-export) | Create directory |
| `readDir` | function | deno-compat.ts (re-export) | Read directory entries |
| `readFile` | function | deno-compat.ts (re-export) | Read file as bytes |
| `readTextFile` | function | deno-compat.ts (re-export) | Read file as text |
| `remove` | function | deno-compat.ts (re-export) | Remove file/directory |
| `setEnv` | function | deno-compat.ts (re-export) | Set environment variable |
| `stat` | function | deno-compat.ts (re-export) | Get file/directory info |
| `waitFor` | function | deno-compat.ts | Poll condition with timeout |
| `withEnv` | function | deno-compat.ts | Run fn with temporary env vars |
| `withTempDir` | function | deno-compat.ts | Run fn with auto-cleaned temp dir |
| `withTempFile` | function | deno-compat.ts | Run fn with auto-cleaned temp file |
| `writeFile` | function | deno-compat.ts (re-export) | Write bytes to file |
| `writeTextFile` | function | deno-compat.ts (re-export) | Write text to file |
| `getTestTimeScale` | function | timing.ts | Read VF_TEST_TIME_SCALE env |
| `scaleMs` | function | timing.ts | Scale milliseconds by time scale |
| `testDelay` | function | timing.ts | Scaled delay for tests |
| `isBun` | boolean | platform/compat (re-export) | Runtime detection |
| `isDeno` | boolean | platform/compat (re-export) | Runtime detection |
| `isNode` | boolean | platform/compat (re-export) | Runtime detection |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `isDeno`, `isBun`, `isNode` | `#veryfront/platform/compat/runtime.ts` | Runtime detection for branching |
| `getEnvOverlayStorage` | `#veryfront/platform/compat/process.ts` | Bun env overlay in BDD hooks |
| `env`, `getEnv`, `setEnv`, `deleteEnv` | `#veryfront/platform/compat/process.ts` | Env snapshot/restore in isolation |
| `@std/testing/bdd` | `#std/testing/bdd` | Deno BDD backend |
| `@std/assert` | `#std/assert.ts` | Deno assertion backend |
| FS re-exports | `#veryfront/platform/compat/fs.ts` | Portable filesystem ops |
| `node:async_hooks` | Node built-in | AsyncLocalStorage for env overlay |
| `node:os`, `node:fs/promises`, `node:path` | Node built-ins | Temp file/dir operations (Node/Bun) |

## Behaviors

### Behavior 1: Test environment initialization (init.ts)
- **Given**: A test file imports from `#veryfront/testing`
- **When**: The module is loaded
- **Then**: `__vfDisableLruInterval`, `__vfTestEnv`, and `__vfTestEnvMask` are set on `globalThis`
- **Edge cases**: Must run before any module-level LRU caches initialize

### Behavior 2: Runtime-adaptive BDD (bdd.ts)
- **Given**: Tests use `describe`/`it`/hooks
- **When**: Running in Deno
- **Then**: Delegates directly to `@std/testing/bdd`
- **When**: Running in Node.js
- **Then**: Dynamically imports `node:test` and wraps it
- **When**: Running in Bun
- **Then**: Dynamically imports `bun:test`, wraps it, and applies env overlay + default timeout
- **Edge cases**: `describe.skip`, `describe.only`, `it.skip`, `it.only` mapped per runtime; `TestOptions.skip` maps to `ignore` in Deno

### Behavior 3: Runtime-adaptive assertions (assert.ts)
- **Given**: Tests call assertion functions
- **When**: Running in Deno
- **Then**: Delegates to `@std/assert`
- **When**: Running in Node.js or Bun
- **Then**: Uses custom polyfill implementation based on `deepEquals`
- **Edge cases**: `assertThrows`/`assertRejects` support both `(fn, ErrorClass, msgIncludes)` and `(fn, msg)` overloads

### Behavior 4: Deep equality (utils.ts)
- **Given**: Two values to compare
- **When**: `deepEquals(a, b)` is called
- **Then**: Compares primitives by value, arrays element-wise, objects key-by-key
- **Edge cases**: Circular references handled via WeakSet (returns `true` on revisit); null checks before typeof

### Behavior 5: Test isolation (isolation.ts)
- **Given**: `installTestIsolation(hooks)` is called with beforeEach/afterEach hooks
- **When**: Each test runs
- **Then**: Env vars are snapshotted/restored, globals are snapshotted/restored, SSR stubs are cleaned, timers are tracked and cleared, all known caches are reset
- **Edge cases**: Uses AsyncLocalStorage when available, falls back to single shared context; env overlay via Proxy on Node/Bun or monkey-patched Deno.env

### Behavior 6: Registered cleanup tasks (isolation.ts)
- **Given**: Code calls `registerTestCleanup(fn)`
- **When**: The afterEach hook fires
- **Then**: All registered tasks run (best-effort, errors swallowed) and the set is cleared

### Behavior 7: Reset all test state (isolation.ts)
- **Given**: `resetAllTestState()` is called
- **When**: During afterEach or explicitly
- **Then**: Clears config cache, environment config, runtime config, layout discovery cache, SSR module cache, React cache, compat hooks, snippet cache, API handler, reload notifier, and HTTP in-flight fetches
- **Edge cases**: Each cleanup is wrapped in try/catch; Bun additionally cleans up bundler

### Behavior 8: Temp file/dir helpers (deno-compat.ts)
- **Given**: `withTempDir(fn)` or `withTempFile(fn)` is called
- **When**: The callback completes (success or failure)
- **Then**: The temp resource is removed (best-effort)
- **Edge cases**: Deno uses native APIs; Node/Bun uses `node:os`+`node:fs/promises`

### Behavior 9: Time scaling (timing.ts)
- **Given**: `VF_TEST_TIME_SCALE` env var is set (e.g., "2")
- **When**: `scaleMs(100)` is called
- **Then**: Returns 200
- **Edge cases**: Invalid/missing env defaults to scale factor 1; minimum value enforced by `minMs` parameter

### Behavior 10: waitFor polling (deno-compat.ts)
- **Given**: A condition function and optional timeout/interval
- **When**: `waitFor(condition)` is called
- **Then**: Polls condition at scaled intervals until true or timeout
- **Edge cases**: Both timeout and interval are time-scaled; throws Error on timeout

## Constraints
- Do NOT change public API signatures
- Do NOT modify files outside src/testing/
- Must pass: `deno fmt --check`, `deno lint`, `deno test --no-check --allow-all`

## Error Handling
- Assertions throw `Error` with descriptive messages
- `assertThrows`/`assertRejects` verify thrown error class and message content
- `resetAllTestState` swallows individual cleanup failures (best-effort)
- `installTestIsolation` hooks swallow individual cleanup failures
- `withTempDir`/`withTempFile` swallow cleanup (removal) errors

## Side Effects
- `init.ts`: Mutates `globalThis` flags on import
- `bdd.ts`: Top-level `await` to import runtime-specific test module
- `assert.ts`: Top-level `await` to import runtime-specific assert module
- `isolation.ts`: `installTestIsolation` monkey-patches `setTimeout`/`setInterval`/`setImmediate`/`requestIdleCallback` and replaces `process.env` with Proxy (Node/Bun) or patches `Deno.env` methods (Deno)
- `deno-compat.ts`: `withTempDir`/`withTempFile` create and delete filesystem resources
- `withEnv` temporarily mutates env vars

## Performance Constraints
- Timer tracker wraps all timer APIs globally (minor overhead per timer call)
- Env proxy adds a Proxy layer over `process.env` (minor overhead per env access)
- `resetAllTestState` dynamically imports ~10 modules (cold import cost, but cached after first)

## Invariants
- After `afterEach` runs, env vars and tracked globals are restored to pre-test state
- `deepEquals` never throws on circular references
- Time-scaled values are always >= `minMs`
- The barrel export (`index.ts`) is the sole public entry point; sub-module imports via import map are for internal cross-file use
