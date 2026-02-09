# How Environment Variables Work in Veryfront API Routes

## Overview

Veryfront uses a **multi-layered, adapter-based architecture** for environment variable handling that supports multiple runtimes (Node.js, Deno, Bun, Cloudflare Workers). Environment variables are injected through runtime adapters and passed through middleware pipelines to API route handlers.

---

## 1. Architecture Overview

### Key Flow:
```
Runtime Environment Variables
    ↓
Runtime Adapter (EnvironmentAdapter)
    ↓
Middleware Pipeline (receives env as Record<string, unknown>)
    ↓
API Route Handler (access via adapter.env.get() or middleware context)
```

### Key Components:
1. **EnvironmentAdapter Interface** (`src/platform/adapters/base.ts`)
2. **Runtime-specific adapters** (Node, Deno, Bun, Cloudflare)
3. **Middleware Pipeline** passes env to context
4. **API Route Handler** receives context and adapter
5. **Environment Configuration** (`src/config/environment-config.ts`)

---

## 2. EnvironmentAdapter Interface

**Location:** `src/platform/adapters/base.ts` (lines 136-140)

```typescript
export interface EnvironmentAdapter {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  toObject(): Record<string, string>;
}
```

All runtime adapters implement this interface for consistent env access.

---

## 3. Runtime-Specific Implementations

### 3.1 Node.js Adapter
**File:** `src/platform/adapters/runtime/node/environment-adapter.ts`

```typescript
export class NodeEnvironmentAdapter implements EnvironmentAdapter {
  get(key: string): string | undefined {
    return process.env[key];
  }

  set(key: string, value: string): void {
    process.env[key] = value;
  }

  toObject(): Record<string, string> {
    return envToObject(process.env);
  }
}
```

- Directly accesses `process.env` (Node.js global)
- Used in: Node.js runtime environments

### 3.2 Deno Adapter
**File:** `src/platform/adapters/runtime/deno/adapter.ts` (class DenoEnvironmentAdapter)

```typescript
class DenoEnvironmentAdapter implements EnvironmentAdapter {
  get(key: string): string | undefined {
    if (typeof Deno === "undefined" || typeof Deno.env === "undefined") return undefined;
    return Deno.env.get(key);
  }

  set(key: string, value: string): void {
    if (typeof Deno === "undefined" || typeof Deno.env === "undefined") {
      throw new Error("DenoEnvironmentAdapter.set() can only be used in Deno runtime");
    }
    Deno.env.set(key, value);
  }

  toObject(): Record<string, string> {
    if (typeof Deno === "undefined" || typeof Deno.env === "undefined") return {};
    return Deno.env.toObject();
  }
}
```

- Uses `Deno.env.get()` and `Deno.env.toObject()`
- Includes runtime safety checks
- Used in: Deno runtime environments

### 3.3 Bun Adapter
**File:** `src/platform/adapters/runtime/bun/environment-adapter.ts`

```typescript
export class BunEnvironmentAdapter implements EnvironmentAdapter {
  get(key: string): string | undefined {
    return process.env[key];
  }

  set(key: string, value: string): void {
    process.env[key] = value;
  }

  toObject(): Record<string, string> {
    return envToObject(process.env);
  }
}
```

- Uses `process.env` (like Node.js)
- Used in: Bun runtime

### 3.4 Cloudflare Adapter
**Files:**
- `src/platform/adapters/runtime/cloudflare/adapter.ts`
- `src/platform/adapters/runtime/cloudflare/environment.ts`
- `src/platform/adapters/runtime/cloudflare/types.ts`

```typescript
// Types
export interface CloudflareEnv {
  [key: string]: string | KVNamespace | DurableObjectNamespace | R2Bucket | unknown;
}

// Adapter
export class CloudflareEnvironmentAdapter implements EnvironmentAdapter {
  constructor(private env: CloudflareEnv) {}

  get(key: string): string | undefined {
    const value = this.env[key];
    return typeof value === "string" ? value : undefined;
  }

  set(key: string, value: string): void {
    this.env[key] = value;
  }

  toObject(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.env)) {
      if (typeof value === "string") result[key] = value;
    }
    return result;
  }
}

// Worker initialization
export function createWorker(
  setup: (env: CloudflareEnv) => MiddlewarePipeline,
): { fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): unknown } {
  return {
    fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): unknown {
      return setup(env).execute(request, env, ctx);
    },
  };
}
```

- Receives `env` from Cloudflare Workers runtime
- Wraps Worker environment bindings
- Also stores other resources (KV, Durable Objects, R2)
- Used in: Cloudflare Workers

---

## 4. How Environment Flows Through the System

### 4.1 Server Startup

**Dev Server** (`src/server/dev-server/server.ts`, line ~160):
```typescript
const baseHandler = (req: Request) => 
  this.pipeline.execute(req, this.adapter.env.toObject());
```

**Production Server** (`src/server/production-server.ts`):
- Creates runtime adapter via `runtime.get()`
- Passes adapter to request handler

### 4.2 Middleware Pipeline

**File:** `src/middleware/core/pipeline/pipeline.ts` (lines 34-46)

```typescript
execute(
  req: Request,
  env?: Record<string, unknown>,
  executionCtx?: ExecutionContext,
  adapter?: RuntimeAdapter,
): Promise<Response> {
  return executeMiddlewarePipeline(
    req,
    this.compose(),
    env,
    executionCtx,
    adapter,
  );
}
```

**Executor** (`src/middleware/core/pipeline/executor.ts`, lines 13-62):
```typescript
export function executeMiddlewarePipeline(
  req: Request,
  composedMiddleware: MiddlewareHandler,
  env?: Record<string, unknown>,
  executionCtx?: ExecutionContext,
  adapter?: RuntimeAdapter,
): Promise<Response> {
  return withSpan(
    "middleware.pipeline.execute",
    async (): Promise<Response> => {
      const context = new MiddlewareContext(req, env ?? {}, executionCtx);
      // ... middleware execution ...
    },
  );
}
```

### 4.3 Middleware Context

**File:** `src/middleware/core/context.ts` (lines 1-60)

```typescript
export class MiddlewareContext implements Context {
  req: Request;
  request: Request;
  env: Record<string, unknown>;
  executionCtx?: ExecutionContext;
  var: Record<string, unknown> = {};

  constructor(
    req: Request,
    env: Record<string, unknown> = {},
    executionCtx?: ExecutionContext,
  ) {
    this.req = req;
    this.request = req;
    this.env = env;
    this.executionCtx = executionCtx;
  }
}
```

**Key:** The `env` is passed as a plain object and available to middleware handlers.

---

## 5. API Routes Access to Environment Variables

### 5.1 In API Route Handlers

API routes receive the **adapter** object through route execution:

**File:** `src/routing/api/route-executor.ts` (lines 23-31)

```typescript
function isDevelopment(adapter: RuntimeAdapter): boolean {
  const env = adapter.env.get("MODE") ??
    adapter.env.get("NODE_ENV") ??
    adapter.env.get("DENO_ENV");

  if (!env) return isDevelopmentEnv();

  const normalized = env.toLowerCase();
  return normalized === "development" || normalized === "dev";
}
```

**App Router Routes** (`src/routing/api/route-executor.ts`, lines 87-122):
```typescript
export function executeAppRoute(
  handler: APIRoute,
  request: Request,
  match: RouteMatch,
  pathname: string,
  adapter: RuntimeAdapter,
): Promise<Response> {
  // ...
  try {
    const appContext: AppRouteContext = { params: normalizeParams(match.params) };
    const response = await resolvedFn(request, appContext);
    // ...
  } catch (error) {
    return handleAPIError(error, pathname, adapter);
  }
}
```

**Pages Router Routes** (`src/routing/api/route-executor.ts`, lines 124-155):
```typescript
export function executePagesRoute(
  handler: APIRoute,
  request: Request,
  match: RouteMatch,
  pathname: string,
  adapter: RuntimeAdapter,
  projectDir?: string,
): Promise<Response> {
  // ...
  try {
    const fs = projectDir ? createProjectScopedFs(adapter.fs, projectDir) : adapter.fs;
    const ctx = createContext(request, match, fs);
    const response = await (methodHandler as PagesRouteHandler)(ctx);
    // ...
  } catch (error) {
    return handleAPIError(error, pathname, adapter);
  }
}
```

### 5.2 How Routes Actually Access Environment

Routes have **two main ways** to access environment variables:

#### Method 1: Via Runtime-Agnostic getEnv() (Recommended)

**File:** `src/platform/compat/process.ts` (lines 55-59)

```typescript
export function getEnv(key: string): string | undefined {
  if (IS_DENO) return Deno.env.get(key);
  if (hasNodeProcess) return nodeProcess!.env[key];
  return undefined;
}
```

Usage in example routes:
```typescript
// From: examples/agent-code-assistant/app/api/chat/route.ts (lines 78-88)
initializeProviders({
  openai: {
    apiKey: (typeof process !== 'undefined' ? process.env.OPENAI_API_KEY : '') ||
            (typeof Deno !== 'undefined' ? Deno.env.get('OPENAI_API_KEY') : '') || '',
  },
});

const cwd = typeof process !== 'undefined' ? process.cwd() :
            (typeof Deno !== 'undefined' ? Deno.cwd() : '.');
```

#### Method 2: Direct Runtime Access

Routes can directly access `process.env` or `Deno.env` depending on runtime:
```typescript
process.env.OPENAI_API_KEY  // Node.js / Bun
Deno.env.get('OPENAI_API_KEY')  // Deno
```

### 5.3 Context Passed to Routes

**Pages Router Context** (`src/routing/api/context-builder.ts`, lines 7-18):
```typescript
export interface APIContext {
  request: Request;
  req: Request;
  params: Record<string, string | string[]>;
  query: URLSearchParams;
  cookies: Record<string, string>;
  headers: Headers;
  url: URL;
  json: (data: unknown, init?: ResponseInit) => Response;
  text: (data: string, init?: ResponseInit) => Response;
  fs: FileSystemAdapter;
}
```

**Note:** `APIContext` does **NOT** include environment variables directly - routes must use the global `getEnv()` or runtime-specific access.

---

## 6. Environment Variable Loading & Configuration

### 6.1 Environment Loading

**File:** `src/utils/env-loader.ts`

Loads `.env` files in order of priority:
1. `.env` (project root)
2. `.env.{NODE_ENV|DENO_ENV}` (e.g., `.env.development`)
3. `.env.local` (local overrides)

```typescript
export async function loadEnv(
  options: {
    cwd?: string;
    override?: boolean;
    debug?: boolean;
  } = {},
): Promise<void> {
  if (envLoaded) return;
  const { cwd = getCwd(), override = false, debug = false } = options;

  const env = getEnv("NODE_ENV") ?? getEnv("DENO_ENV") ?? "development";
  const envFiles = [`${cwd}/.env`, `${cwd}/.env.${env}`, `${cwd}/.env.local`];

  for (const file of envFiles) {
    try {
      const content = await readTextFile(file);
      const vars = parseEnvFile(content);
      for (const [key, value] of Object.entries(vars)) {
        const existing = getEnv(key);
        if (existing && !override) continue;
        setEnv(key, value);
        // ...
      }
    } catch (error) {
      // Handle file not found or parse errors
    }
  }
  envLoaded = true;
}
```

### 6.2 Centralized Environment Configuration

**File:** `src/config/environment-config.ts`

Provides centralized typed access to common environment variables:

```typescript
export interface EnvironmentConfig {
  nodeEnv: "development" | "production" | "test" | string;
  veryfrontEnv: string;
  veryfrontMode: string;

  debug: boolean;
  ci: boolean;
  denoTesting: boolean;
  perfEnabled: boolean;

  apiBaseUrl: string;
  apiUrl: string | undefined;
  apiToken: string | undefined;
  projectSlug: string | undefined;

  redisUrl: string | undefined;
  cacheDir: string | undefined;

  port: number;
  requestTimeoutMs: number | undefined;
  httpFetchTimeoutMs: number | undefined;

  otelEnabled: boolean;
  otelServiceName: string | undefined;
  // ... more fields
}

export function getEnvironmentConfig(): EnvironmentConfig {
  // Returns cached config after env file loading
}
```

**Function Usage:**
```typescript
const config = getEnvironmentConfig();
const apiUrl = config.apiUrl;
const isDebug = config.debug;
```

---

## 7. Remote Environment / Production Deployment

### 7.1 Environment Resolution

**File:** `src/server/runtime-handler/environment-resolution.ts`

Resolves environment context (preview vs production):

```typescript
export interface EnvironmentResolutionOptions {
  proxyEnv: ProxyEnvironment | undefined;
  reqCtxMode: "preview" | "production" | undefined;
  releaseId: string | undefined;
  projectSlug: string | undefined;
  projectId: string | undefined;
  environmentName: string | undefined;
  host: string;
  isLocalProject: boolean;
  isProxyMode: boolean;
  pathname: string;
  defaultEnvironment: "preview" | "production" | undefined;
}

export function resolveEnvironment(
  opts: EnvironmentResolutionOptions,
): EnvironmentResolutionResult {
  let resolvedEnvironment: "preview" | "production" | undefined =
    opts.proxyEnv === "preview" || opts.proxyEnv === "production" ? opts.proxyEnv : opts.reqCtxMode;
  
  // Validates releaseId in production mode
  // Falls back to synthetic release ID in standalone dev mode
}
```

### 7.2 Cloudflare Remote Deployment

For Cloudflare Workers deployment:

1. **Environment variables** are set in `wrangler.toml`:
```toml
[env.production]
vars = { API_URL = "https://api.example.com", ... }
```

2. **Worker receives environment** via the `env` parameter:
```typescript
// From: src/platform/adapters/runtime/cloudflare/worker.ts
export function createWorker(
  setup: (env: CloudflareEnv) => MiddlewarePipeline,
): { fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): unknown } {
  return {
    fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext): unknown {
      return setup(env).execute(request, env, ctx);
    },
  };
}
```

3. **CloudflareEnvironmentAdapter** wraps this env for consistent access

### 7.3 Node.js / Deno Production

1. **Environment variables** come from:
   - System environment
   - `.env` files (via `loadEnv()`)
   - Passed at runtime

2. **Adapter** directly accesses via `process.env` or `Deno.env`

---

## 8. Testing & Environment Isolation

### 8.1 Test Environment Setup

**File:** `src/routing/api/module-loader/loader.test.ts` (lines 7-59)

```typescript
import { env, getEnv, setEnv } from "#veryfront/compat/process.ts";

// Create mock adapter with test env
const mockAdapter: RuntimeAdapter = {
  id: "memory",
  name: "memory",
  capabilities: { /* ... */ },
  fs: createFileSystem(),
  env: {
    get(key: string) {
      return getEnv(key);
    },
    set(key: string, value: string) {
      setEnv(key, value);
    },
    toObject() {
      return env();
    },
  },
  // ... other adapter properties
};
```

### 8.2 AsyncLocalStorage Context Isolation

**File:** `src/platform/compat/process.ts` (lines 157-176)

```typescript
export function getEnvOverlayStorage(): EnvOverlayStorage | null {
  const globalAny = globalThis as Record<string, unknown>;
  const overlay =
    (globalAny["__vfTestDenoEnvOverlay"] as { storage?: EnvOverlayStorage } | undefined) ??
      (globalAny["__vfTestEnvOverlay"] as { storage?: EnvOverlayStorage } | undefined);

  const storage = overlay?.storage;
  if (!storage || typeof storage.getStore !== "function") return null;
  return storage;
}
```

Enables per-async-context environment isolation for tests.

---

## 9. Key Environment Variables Used in Codebase

**From `.env.example`:**
- `NODE_ENV` / `DENO_ENV` - Runtime environment (development/production/test)
- `VERYFRONT_API_BASE_URL` - Veryfront API endpoint
- `VERYFRONT_API_TOKEN` - Authentication token
- `VERYFRONT_PROJECT_SLUG` - Project identifier
- `REDIS_URL` - Redis connection string
- `OTEL_*` - OpenTelemetry tracing configuration
- `OPENAI_API_KEY` - LLM integration
- `ANTHROPIC_API_KEY` - Claude API key
- `GOOGLE_API_KEY` - Google services
- `LOG_LEVEL` - Logging level
- `PORT` - Server port
- `VERYFRONT_DEBUG` - Debug mode flag

---

## 10. Summary: How API Routes Access Environment

```
┌─────────────────────────────────────────────────────┐
│   API Route Handler (route.ts / pages/api/*.ts)    │
└────────────────────┬────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
   Method 1:              Method 2:
   getEnv() from          Direct access
   compat/process.ts      process.env or
                          Deno.env.get()
        │                         │
        └────────────┬────────────┘
                     │
        ┌────────────▼────────────┐
        │   Runtime Adapter      │
        │  (env: EnvironmentAdapter)
        │  - NodeEnvironmentAdapter
        │  - DenoEnvironmentAdapter
        │  - BunEnvironmentAdapter
        │  - CloudflareEnvAdapter
        └────────────┬────────────┘
                     │
        ┌────────────▼────────────┐
        │  Actual Runtime         │
        │  - process.env (Node)   │
        │  - Deno.env (Deno)      │
        │  - CloudflareEnv obj    │
        └────────────────────────┘
```

**Best Practice:** Use `getEnv()` from `#veryfront/platform/compat/process.ts` for runtime-agnostic code, or use the centralized `getEnvironmentConfig()` for typed configuration access.

---

## References

### Core Files
- `src/platform/adapters/base.ts` - EnvironmentAdapter interface
- `src/platform/compat/process.ts` - Runtime-agnostic env access
- `src/config/environment-config.ts` - Centralized configuration
- `src/utils/env-loader.ts` - .env file loading
- `src/middleware/core/context.ts` - Middleware environment context
- `src/routing/api/route-executor.ts` - API route execution
- `src/server/dev-server/server.ts` - Dev server env passing
- `src/server/production-server.ts` - Production server setup

### Runtime Adapters
- `src/platform/adapters/runtime/node/environment-adapter.ts`
- `src/platform/adapters/runtime/deno/adapter.ts`
- `src/platform/adapters/runtime/bun/environment-adapter.ts`
- `src/platform/adapters/runtime/cloudflare/adapter.ts`

### Testing
- `src/routing/api/module-loader/loader.test.ts`
- Environment isolation using AsyncLocalStorage
