# Chapter 6: Runtime Conditional Branching

## Executive Summary

The veryfront-renderer codebase contains **249 runtime conditional occurrences** across **85 files** in `src/`. These checks (`isDeno`, `isNode`, `isBun`, `isBrowser`, `isCloudflare`) are scattered throughout business logic rather than isolated in the platform abstraction layer. While a sophisticated adapter pattern exists in `src/platform/`, runtime detection has leaked into transforms, CLI, rendering, testing, and other domains.

---

## 1. The Problem

### 1.1 Current State

Runtime detection logic appears in three distinct locations:

1. **Proper location** (`src/platform/`): ~120 occurrences - the intended abstraction layer
2. **Leaked locations** (outside `src/platform/`): ~129 occurrences - business logic pollution

### 1.2 Why This Is a Problem

1. **Violation of Separation of Concerns**: Business logic (transforms, CLI, rendering) should not know about runtime differences
2. **Testing Complexity**: Each runtime check creates a test matrix explosion
3. **Maintenance Burden**: Adding a new runtime requires modifying files across the entire codebase
4. **Bug Surface**: Inconsistent runtime handling leads to "works in Deno, fails in Node" bugs
5. **Code Duplication**: Similar conditional patterns repeated in multiple files

### 1.3 Root Cause

The existing adapter pattern in `src/platform/` is **incomplete**. It covers:
- File system operations
- Environment variables
- HTTP servers
- WebSocket upgrades

But it does **not** cover:
- Module imports (npm:, https:, node:)
- Package resolution paths
- Dynamic import strategies
- Redis client loading
- AWS SDK loading
- Test framework selection

---

## 2. Statistics

### 2.1 Overall Numbers

| Metric | Count |
|--------|-------|
| Total runtime check occurrences | 249 |
| Files with runtime checks | 85 |
| Files in `src/platform/` (proper) | 40 |
| Files outside `src/platform/` (leaked) | 45 |
| Occurrences in `src/platform/` | ~120 |
| Occurrences outside `src/platform/` | ~129 |

### 2.2 Files with Most Runtime Checks (Outside Platform)

| File | Occurrences | Category |
|------|-------------|----------|
| `src/testing/isolation.ts` | 5 | Testing |
| `src/testing/bdd.ts` | 4 | Testing |
| `src/testing/deno-compat.ts` | 6 | Testing |
| `src/cli/discovery/index.ts` | 4 | CLI |
| `src/transforms/esm/http-cache.ts` | 4 | Transforms |
| `src/modules/server/ssr-import-rewriter.ts` | 3 | Modules |
| `src/html/styles-builder/tailwind-compiler.ts` | 3 | HTML |
| `src/cli/auth/callback-server.ts` | 3 | CLI |
| `src/utils/file-discovery.ts` | 4 | Utils |
| `src/workflow/blob/s3-storage.ts` | 2 | Workflow |

### 2.3 Distribution by Domain

| Domain | Files | Occurrences |
|--------|-------|-------------|
| `src/platform/` (proper location) | 40 | ~120 |
| `src/testing/` | 5 | ~21 |
| `src/transforms/` | 7 | ~18 |
| `src/cli/` | 7 | ~15 |
| `src/modules/` | 3 | ~8 |
| `src/utils/` | 3 | ~9 |
| `src/rendering/` | 2 | ~4 |
| `src/workflow/` | 1 | ~2 |
| `src/html/` | 1 | ~3 |
| `src/observability/` | 1 | ~2 |
| `src/config/` | 1 | ~2 |

---

## 3. Categories of Runtime Conditionals

### 3.1 Module Import Strategy (Critical - 28 occurrences)

**Problem**: Different runtimes resolve modules differently.

```typescript
// src/workflow/blob/s3-storage.ts:23
s3Module = isDeno
  ? await import("https://esm.sh/@aws-sdk/client-s3@3.490.0")
  : await import("@aws-sdk/client-s3");
```

```typescript
// src/platform/adapters/redis/modules.ts:20-27
if (isDeno) {
  const denoRedisUrl = ["https://deno.land/x/redis", "@v0.32.1/mod.ts"].join("");
  DenoRedis = await import(denoRedisUrl);
} else {
  const redisModuleName = ["re", "dis"].join("");
  NodeRedis = await import(redisModuleName);
}
```

```typescript
// src/cli/discovery/index.ts:122-126
const relativeImports = isDeno
  ? [...source.matchAll(/from\s+["'](\.\.[^"']+)["']/g)].map((m) => m[1]!).filter(Boolean)
  : [];

const plugins = !isDeno && context.fsAdapter ? [createFsAdapterPlugin(context.fsAdapter)] : [];
```

**Impact**: This is the most critical category because it affects how the entire module system works.

### 3.2 Module Rewriting/Resolution (22 occurrences)

**Problem**: SSR import rewriting differs by runtime.

```typescript
// src/modules/server/ssr-import-rewriter.ts:22
return isDeno;  // Returns whether to use npm: protocol
```

```typescript
// src/transforms/esm/http-cache.ts:215-219
// For Deno: Skip React core modules (prevents multiple instances).
// For Node.js: Must cache React to disk because Node.js can't import HTTP URLs.
if (isDeno && isReactCoreUrl(normalizedUrl)) {
  return null;  // Deno can use HTTP URLs directly
}
```

```typescript
// src/transforms/esm/http-cache.ts:397
if (isDeno) {
  return specifier; // Let Deno's native npm resolution handle it
}
```

### 3.3 Test Framework Selection (21 occurrences)

**Problem**: Test utilities must adapt to runtime capabilities.

```typescript
// src/testing/bdd.ts:43
if (isDeno) {
  const denoTest = await import("#std/testing/bdd.ts");
  rawDescribe = denoTest.describe;
  rawIt = denoTest.it;
  beforeAll = denoTest.beforeAll;
  // ...
}
```

```typescript
// src/testing/assert.ts:244
if (isDeno) {
  const std = await import("#std/assert.ts");
  assertEquals = std.assertEquals;
  assertExists = std.assertExists;
  // ...
}
```

```typescript
// src/testing/isolation.ts:311
if (!isDeno) return null;  // Env isolation only works in Deno
```

### 3.4 CLI and Interactive Operations (15 occurrences)

**Problem**: CLI needs to handle stdin/stdout differently.

```typescript
// src/cli/auth/callback-server.ts:165
if (isDeno) {
  Deno.stdin.setRaw(true);
  const reader = Deno.stdin.readable.getReader();
  // ... Deno-specific stdin handling
}
```

```typescript
// src/cli/auth/callback-server.ts:277
return isDeno ? startDenoServer(port) : startNodeServer(port);
```

### 3.5 React Path Resolution (8 occurrences)

**Problem**: React packages resolve differently across runtimes.

```typescript
// src/platform/compat/react-paths.ts:37-42
if (isBun && hasBunResolveSync() && Bun?.resolveSync) {
  return { "react-dom/server": resolvedPath };
}
if (isNode) {
  const resolved = require.resolve("react-dom/server");
  // ...
}
```

```typescript
// src/transforms/esm/react-imports.ts:38
const ssrReactImports = isDeno || isNode
  ? getReactSsrImports()
  : {};
```

### 3.6 File System Operations (Already in adapters but leaked)

**Problem**: Some FS operations leaked outside platform layer.

```typescript
// src/rendering/script-page-handling.ts:311
const isDeno = typeof (globalThis as { Deno?: unknown }).Deno !== "undefined";
if (!isDeno) return code;

for (const { pattern, replacement } of NPM_REWRITES) {
  result = result.replace(pattern, replacement);
}
```

### 3.7 HTTP Server Creation (8 occurrences)

**Problem**: Different HTTP server implementations per runtime.

```typescript
// src/platform/compat/http/factory.ts:7
export function createHttpServer(): HttpServer {
  return isDeno ? new DenoHttpServer() : new NodeHttpServer();
}
```

```typescript
// src/platform/compat/http/websocket.ts:8
if (!isDeno) {
  throw new Error("WebSocket upgrade not supported in this runtime");
}
```

### 3.8 Process/Environment Operations (Correctly in platform)

These are correctly placed in `src/platform/compat/process.ts`:

```typescript
export function getArgs(): string[] {
  if (IS_DENO) return Deno.args;
  if (hasNodeProcess) return nodeProcess!.argv.slice(2);
  return [];
}

export function exit(code?: number): never {
  if (IS_DENO) Deno.exit(code);
  if (hasNodeProcess) nodeProcess!.exit(code);
  throw new Error("exit() is not supported in this runtime");
}
```

---

## 4. Existing Platform Adapter Pattern

### 4.1 Architecture Overview

The existing adapter pattern is well-designed:

```
src/platform/
├── adapters/
│   ├── base.ts              # RuntimeAdapter interface
│   ├── registry.ts          # Singleton adapter management
│   ├── runtime-detection.ts # detectRuntime()
│   ├── deno.ts              # Deno implementation
│   ├── node.ts              # Node.js implementation
│   ├── bun.ts               # Bun implementation
│   ├── fs/                  # File system adapters
│   └── redis/               # Redis adapters
└── compat/
    ├── runtime.ts           # isDeno, isNode, isBun exports
    ├── fs.ts                # Cross-runtime FS
    ├── process.ts           # Cross-runtime process
    ├── crypto.ts            # Cross-runtime crypto
    ├── stdin.ts             # Cross-runtime stdin
    └── path/                # Cross-runtime path
```

### 4.2 RuntimeAdapter Interface (src/platform/adapters/base.ts)

```typescript
export interface RuntimeAdapter {
  readonly id: RuntimeId;
  readonly name: string;
  readonly capabilities: RuntimeCapabilities;

  fs: FileSystemAdapter;
  env: EnvironmentAdapter;
  server: ServerAdapter;

  serve(handler: RequestHandler, options: ServeOptions): Promise<Server>;

  shell?: ShellAdapter;
  kv?: KVStoreAdapter;
  watcher?: FileWatcherAdapter;

  initialize?(): Promise<void>;
  shutdown?(): Promise<void>;
}
```

### 4.3 Registry Pattern (src/platform/adapters/registry.ts)

```typescript
class AdapterRegistry {
  private instance: RuntimeAdapter | null = null;
  private loaders = new Map<RuntimeId, AdapterLoader>();

  constructor() {
    this.loaders.set("deno", async () => (await import("./deno.ts")).denoAdapter);
    this.loaders.set("node", async () => (await import("./node.ts")).nodeAdapter);
    this.loaders.set("bun", async () => (await import("./bun.ts")).bunAdapter);
  }

  async get(): Promise<RuntimeAdapter> {
    const runtimeId = detectRuntime();
    const loader = this.loaders.get(runtimeId);
    return await loader();
  }
}

export const runtime = new AdapterRegistry();
```

**Usage**:
```typescript
import { runtime } from "#veryfront/platform/adapters/registry.ts";

const adapter = await runtime.get();
const content = await adapter.fs.readFile(path);
```

### 4.4 What's Missing From Adapters

| Capability | Status | Where Used |
|------------|--------|------------|
| File system | Covered | Works well |
| Environment | Covered | Works well |
| HTTP server | Covered | Works well |
| WebSocket | Partial | Only Deno |
| **Module loading** | NOT COVERED | 28 occurrences |
| **Package resolution** | NOT COVERED | 22 occurrences |
| **Test framework** | NOT COVERED | 21 occurrences |
| **Redis client** | Partial | Has adapter but leaks |
| **AWS SDK** | NOT COVERED | 2 occurrences |

---

## 5. Code Examples (Representative)

### 5.1 Most Problematic: Module Import Strategy

**Current** (`src/workflow/blob/s3-storage.ts`):
```typescript
import { isDeno } from "#veryfront/platform/compat/runtime.ts";

async function getS3Module(): Promise<typeof import("@aws-sdk/client-s3")> {
  if (s3Module) return s3Module;

  try {
    s3Module = isDeno
      ? await import("https://esm.sh/@aws-sdk/client-s3@3.490.0")
      : await import("@aws-sdk/client-s3");
    return s3Module;
  } catch (error) {
    throw new Error(`Failed to load @aws-sdk/client-s3...`);
  }
}
```

**Should Be**:
```typescript
import { runtime } from "#veryfront/platform/adapters/registry.ts";

async function getS3Module(): Promise<typeof import("@aws-sdk/client-s3")> {
  const adapter = await runtime.get();
  return adapter.modules.loadAwsS3();
}
```

### 5.2 HTTP Cache Module Resolution

**Current** (`src/transforms/esm/http-cache.ts`):
```typescript
// Line 215: Skip React caching for Deno
if (isDeno && isReactCoreUrl(normalizedUrl)) {
  return null;
}

// Line 397: npm: specifier handling
if (isDeno) {
  return specifier; // Let Deno's native npm resolution handle it
}

// Line 421: React core URL handling
if (isDeno && isReactCoreUrl(resolved)) {
  return normalizeHttpUrl(resolved);
}
```

**Should Be**:
```typescript
const adapter = await runtime.get();

if (adapter.capabilities.nativeHttpImports && isReactCoreUrl(normalizedUrl)) {
  return null; // Runtime handles HTTP imports directly
}

if (adapter.capabilities.nativeNpmProtocol) {
  return specifier; // Runtime handles npm: protocol
}
```

### 5.3 Test Framework Selection

**Current** (`src/testing/bdd.ts`):
```typescript
if (isDeno) {
  const denoTest = await import("#std/testing/bdd.ts");
  rawDescribe = denoTest.describe;
  rawIt = denoTest.it;
  beforeAll = denoTest.beforeAll;
  afterAll = denoTest.afterAll;
  beforeEach = denoTest.beforeEach;
  afterEach = denoTest.afterEach;
}

if (isBun) {
  const bunTest = await import("bun:test");
  rawDescribe = bunTest.describe;
  rawIt = bunTest.it;
  // ...
}
```

**Should Be**:
```typescript
import { runtime } from "#veryfront/platform/adapters/registry.ts";

const adapter = await runtime.get();
const testFramework = await adapter.testing.getFramework();

rawDescribe = testFramework.describe;
rawIt = testFramework.it;
beforeAll = testFramework.beforeAll;
// ...
```

---

## 6. What Should Be Abstracted

### 6.1 New Adapter Capabilities Required

```typescript
interface RuntimeAdapter {
  // Existing (keep as-is)
  fs: FileSystemAdapter;
  env: EnvironmentAdapter;
  server: ServerAdapter;

  // NEW: Module system adapter
  modules: ModuleSystemAdapter;

  // NEW: Testing adapter
  testing?: TestingAdapter;

  // Enhanced capabilities
  capabilities: RuntimeCapabilities;
}

interface ModuleSystemAdapter {
  /** Resolve and load a bare specifier */
  import<T = unknown>(specifier: string): Promise<T>;

  /** Get the correct import specifier for a package */
  resolveSpecifier(pkg: string, version?: string): string;

  /** Check if runtime supports HTTP imports */
  supportsHttpImports: boolean;

  /** Check if runtime supports npm: protocol */
  supportsNpmProtocol: boolean;

  /** Load optional dependencies (Redis, AWS, etc.) */
  loadOptionalDep(name: "redis" | "aws-s3" | "esbuild"): Promise<unknown>;
}

interface RuntimeCapabilities {
  // Existing
  typescript: boolean;
  jsx: boolean;
  http2: boolean;
  websocket: boolean;
  workers: boolean;
  fileWatching: boolean;
  shell: boolean;
  kvStore: boolean;
  writableFs: boolean;

  // NEW
  nativeHttpImports: boolean;    // Can import https:// URLs
  nativeNpmProtocol: boolean;    // Can use npm: specifiers
  nativeTypeScript: boolean;     // Native TS without transpilation
  moduleResolution: "node" | "deno" | "bun";
}

interface TestingAdapter {
  getFramework(): Promise<TestFramework>;
  createIsolation(): Promise<TestIsolation>;
}
```

### 6.2 Files That Should Have NO Runtime Checks

After refactoring, these files should have zero `isDeno`/`isNode`/`isBun` checks:

| File | Current Checks | Should Have |
|------|----------------|-------------|
| `src/transforms/esm/http-cache.ts` | 4 | 0 |
| `src/transforms/esm/http-bundler.ts` | 2 | 0 |
| `src/transforms/esm/react-imports.ts` | 2 | 0 |
| `src/modules/server/ssr-import-rewriter.ts` | 3 | 0 |
| `src/cli/discovery/index.ts` | 4 | 0 |
| `src/workflow/blob/s3-storage.ts` | 2 | 0 |
| `src/html/styles-builder/tailwind-compiler.ts` | 3 | 0 |
| `src/rendering/script-page-handling.ts` | 2 | 0 |
| `src/config/loader.ts` | 2 | 0 |
| `src/utils/file-discovery.ts` | 4 | 0 |
| `src/observability/simple-metrics/otel-instruments.ts` | 2 | 0 |

---

## 7. Success Criteria

### 7.1 Quantitative Goals

| Metric | Current | Target |
|--------|---------|--------|
| Files with runtime checks outside `src/platform/` | 45 | 10 (tests only) |
| Occurrences outside `src/platform/` | ~129 | ~30 (tests only) |
| Runtime checks in transforms | 18 | 0 |
| Runtime checks in CLI | 15 | 0 |
| Runtime checks in rendering | 4 | 0 |
| Runtime checks in workflow | 2 | 0 |

### 7.2 Qualitative Goals

1. **Single Source of Truth**: All runtime detection in `src/platform/adapters/runtime-detection.ts`
2. **Adapter-Only Access**: Business logic uses adapter capabilities, never raw runtime checks
3. **Test Isolation**: Test files may check runtime for skip/ignore, but not for implementation
4. **New Runtime Support**: Adding Cloudflare Workers should require changes ONLY in `src/platform/`

### 7.3 Allowed Runtime Checks Outside Platform

Only these patterns should remain:

```typescript
// OK: Test skipping
const denoOnlyIt = isDeno ? it : it.skip;
describe("Deno-specific", { skip: !isDeno }, () => {});

// OK: Capability assertion in tests
if (!isDeno) return; // Skip test on other runtimes

// NOT OK: Business logic branching
if (isDeno) {
  // Do Deno thing
} else {
  // Do Node thing
}
```

---

## 8. Recommended Solution

### 8.1 Phase 1: Extend RuntimeAdapter Interface

**File**: `src/platform/adapters/base.ts`

Add new interfaces:

```typescript
export interface ModuleSystemAdapter {
  /**
   * Resolve a package to its importable specifier.
   * Handles npm:, https://, and bare specifiers.
   */
  resolvePackage(name: string, version?: string): string;

  /**
   * Dynamically import a module.
   * Handles runtime-specific resolution.
   */
  dynamicImport<T>(specifier: string): Promise<T>;

  /**
   * Load an optional dependency (fails gracefully if not installed).
   */
  loadOptionalDependency<T>(
    name: string,
    denoUrl?: string,
    npmPackage?: string
  ): Promise<T | null>;

  /** Can import https:// URLs directly */
  readonly supportsHttpImports: boolean;

  /** Can use npm: protocol in imports */
  readonly supportsNpmProtocol: boolean;
}

export interface TestingAdapter {
  /** Get the test framework for this runtime */
  getFramework(): Promise<{
    describe: DescribeFn;
    it: ItFn;
    beforeAll: HookFn;
    afterAll: HookFn;
    beforeEach: HookFn;
    afterEach: HookFn;
  }>;

  /** Get assertion utilities */
  getAssertions(): Promise<{
    assertEquals: AssertEqualsFn;
    assertExists: AssertExistsFn;
    // ...
  }>;
}
```

### 8.2 Phase 2: Implement Per-Runtime Module Adapters

**File**: `src/platform/adapters/runtime/deno/module-adapter.ts`

```typescript
export const denoModuleAdapter: ModuleSystemAdapter = {
  supportsHttpImports: true,
  supportsNpmProtocol: true,

  resolvePackage(name: string, version?: string): string {
    // Deno can use npm: protocol directly
    return version ? `npm:${name}@${version}` : `npm:${name}`;
  },

  async dynamicImport<T>(specifier: string): Promise<T> {
    return await import(specifier) as T;
  },

  async loadOptionalDependency<T>(
    name: string,
    denoUrl?: string,
    _npmPackage?: string
  ): Promise<T | null> {
    try {
      // Prefer esm.sh URL for Deno
      const url = denoUrl ?? `https://esm.sh/${name}`;
      return await import(url) as T;
    } catch {
      return null;
    }
  }
};
```

**File**: `src/platform/adapters/runtime/node/module-adapter.ts`

```typescript
export const nodeModuleAdapter: ModuleSystemAdapter = {
  supportsHttpImports: false,
  supportsNpmProtocol: false,

  resolvePackage(name: string, _version?: string): string {
    // Node uses bare specifiers, resolved via node_modules
    return name;
  },

  async dynamicImport<T>(specifier: string): Promise<T> {
    return await import(specifier) as T;
  },

  async loadOptionalDependency<T>(
    _name: string,
    _denoUrl?: string,
    npmPackage?: string
  ): Promise<T | null> {
    if (!npmPackage) return null;
    try {
      return await import(npmPackage) as T;
    } catch {
      return null;
    }
  }
};
```

### 8.3 Phase 3: Refactor High-Impact Files

#### 3.1: `src/transforms/esm/http-cache.ts`

Replace:
```typescript
if (isDeno && isReactCoreUrl(normalizedUrl)) { ... }
```

With:
```typescript
const adapter = await runtime.get();
if (adapter.modules.supportsHttpImports && isReactCoreUrl(normalizedUrl)) { ... }
```

#### 3.2: `src/workflow/blob/s3-storage.ts`

Replace:
```typescript
s3Module = isDeno
  ? await import("https://esm.sh/@aws-sdk/client-s3@3.490.0")
  : await import("@aws-sdk/client-s3");
```

With:
```typescript
const adapter = await runtime.get();
s3Module = await adapter.modules.loadOptionalDependency(
  "@aws-sdk/client-s3",
  "https://esm.sh/@aws-sdk/client-s3@3.490.0",
  "@aws-sdk/client-s3"
);
```

#### 3.3: `src/cli/discovery/index.ts`

Replace direct `isDeno` checks with adapter capability checks.

### 8.4 Phase 4: Create Testing Adapter

Move test framework selection into the adapter:

**File**: `src/platform/adapters/testing/deno-testing.ts`

```typescript
export async function getDenoTestFramework() {
  const bdd = await import("#std/testing/bdd.ts");
  return {
    describe: bdd.describe,
    it: bdd.it,
    beforeAll: bdd.beforeAll,
    afterAll: bdd.afterAll,
    beforeEach: bdd.beforeEach,
    afterEach: bdd.afterEach,
  };
}
```

Then `src/testing/bdd.ts` becomes:

```typescript
import { runtime } from "#veryfront/platform/adapters/registry.ts";

const adapter = await runtime.get();
const framework = await adapter.testing?.getFramework();

export const describe = framework?.describe ?? fallbackDescribe;
export const it = framework?.it ?? fallbackIt;
// ...
```

### 8.5 Migration Order

1. **Week 1**: Add `ModuleSystemAdapter` interface and implement for Deno/Node/Bun
2. **Week 2**: Refactor `src/transforms/esm/` (highest impact, 18 occurrences)
3. **Week 3**: Refactor `src/cli/` and `src/workflow/` (15 + 2 occurrences)
4. **Week 4**: Add `TestingAdapter` and refactor `src/testing/` (21 occurrences)
5. **Week 5**: Clean up remaining scattered checks

---

## 9. Appendix: Complete File List

### 9.1 Files in `src/platform/` (Proper Location - 40 files)

These files are correctly placed and should remain:

```
src/platform/adapters/base.ts
src/platform/adapters/bun.ts
src/platform/adapters/deno.ts
src/platform/adapters/detect.ts
src/platform/adapters/node.ts
src/platform/adapters/registry.ts
src/platform/adapters/runtime-detection.ts
src/platform/adapters/redis/modules.ts
src/platform/compat/console/index.ts
src/platform/compat/crypto.ts
src/platform/compat/fs.ts
src/platform/compat/http/factory.ts
src/platform/compat/http/websocket.ts
src/platform/compat/kv/factory.ts
src/platform/compat/path/*.ts
src/platform/compat/process.ts
src/platform/compat/react-paths.ts
src/platform/compat/runtime.ts
src/platform/compat/stdin.ts
src/platform/compat/std/*.ts
(and associated test files)
```

### 9.2 Files Outside `src/platform/` That Need Refactoring (45 files)

**Transforms** (7 files):
- `src/transforms/esm/http-cache.ts` (4 occurrences)
- `src/transforms/esm/http-bundler.ts` (2 occurrences)
- `src/transforms/esm/react-imports.ts` (2 occurrences)
- `src/transforms/pipeline/context.ts` (1 occurrence)
- `src/transforms/mdx/esm-module-loader/constants.ts` (2 occurrences)
- `src/transforms/mdx/esm-module-loader/loader.ts` (2 occurrences)
- `src/transforms/pipeline/stages/*.ts` (various)

**CLI** (7 files):
- `src/cli/discovery/index.ts` (4 occurrences)
- `src/cli/auth/callback-server.ts` (3 occurrences)
- `src/cli/utils/env-prompt.ts` (2 occurrences)
- `src/cli/utils/terminal-select.ts` (2 occurrences)
- `src/cli/commands/init/interactive-wizard.ts` (2 occurrences)
- `src/cli/commands/generate/integration-generator.ts` (2 occurrences)
- `src/cli/commands/demo/demo.integration.test.ts` (2 occurrences)

**Testing** (5 files):
- `src/testing/isolation.ts` (5 occurrences)
- `src/testing/bdd.ts` (4 occurrences)
- `src/testing/deno-compat.ts` (6 occurrences)
- `src/testing/assert.ts` (2 occurrences)
- `src/testing/index.ts` (1 occurrence - re-export)

**Modules** (3 files):
- `src/modules/server/ssr-import-rewriter.ts` (3 occurrences)
- `src/modules/server/module-server.ts` (1 occurrence)
- `src/modules/import-map/default-import-map.ts` (1 occurrence)

**Utils** (4 files):
- `src/utils/file-discovery.ts` (4 occurrences)
- `src/utils/platform.ts` (2 occurrences)
- `src/utils/bundle-manifest-init.ts` (2 occurrences)
- `src/utils/bundle-manifest-redis.ts` (3 occurrences)

**Rendering** (2 files):
- `src/rendering/script-page-handling.ts` (2 occurrences)
- `src/rendering/ssr/mdx-module-loader.ts` (2 occurrences)

**Other** (5 files):
- `src/workflow/blob/s3-storage.ts` (2 occurrences)
- `src/html/styles-builder/tailwind-compiler.ts` (3 occurrences)
- `src/observability/simple-metrics/otel-instruments.ts` (2 occurrences)
- `src/config/loader.ts` (2 occurrences)
- `src/security/sandbox/deno-sandbox.ts` (3 occurrences)

---

## 10. Conclusion

The veryfront-renderer has a well-designed platform abstraction layer, but runtime detection has leaked into business logic. The solution is not to rewrite the adapter pattern, but to **extend it** to cover the missing capabilities (module loading, testing, optional dependencies) and **migrate** the scattered runtime checks to use the adapter's capabilities interface.

The key insight is that code should ask "what can this runtime do?" via `adapter.capabilities` rather than "which runtime is this?" via `isDeno`/`isNode`/`isBun`. This shifts from identity-based branching to capability-based branching, which is more maintainable and extensible.
