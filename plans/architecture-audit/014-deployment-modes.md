# Chapter 14: Deployment Modes - Local Dev vs Preview vs Production vs Remote

## Executive Summary

The veryfront-renderer has **three orthogonal axes** of deployment mode configuration:

1. **Runtime Environment** (`NODE_ENV`): `development` | `production` | `test`
2. **Content Source** (`productionMode`/`PRODUCTION_MODE`): Draft (branch) vs Published (release)
3. **Deployment Topology** (`PROXY_MODE`/`proxyMode`): Local vs Remote (proxy-to-renderer)

These axes interact in complex ways, creating multiple behavior divergences that can cause "works in dev, breaks in prod" issues.

---

## Sub-Analyses

| Document | Severity | Description | Multi-Tenant Impact |
|----------|----------|-------------|---------------------|
| [014.0-deployment-modes-rfc.md](./014.0-deployment-modes-rfc.md) | RFC | Unified ModeResolver architecture | Foundation for all fixes |
| [014.1-node-env-missing.md](./014.1-node-env-missing.md) | HIGH | Missing NODE_ENV defaults to development | All projects get dev behavior |
| [014.2-missing-release-id.md](./014.2-missing-release-id.md) | HIGH | Production without releaseId returns 502 | Production projects fail |
| [014.3-combined-split-divergence.md](./014.3-combined-split-divergence.md) | MEDIUM | Combined vs split mode behavior differs | Different behavior per mode |
| [014.4-cache-ttl-misclassification.md](./014.4-cache-ttl-misclassification.md) | MEDIUM | Wrong TTL selection (36x difference) | Cache efficiency degraded |
| [014.5-header-domain-conflicts.md](./014.5-header-domain-conflicts.md) | MEDIUM | Header/domain precedence undefined | Wrong environment selected |

---

## Table of Contents

1. [Mode Classification](#1-mode-classification)
2. [Runtime Environment: NODE_ENV](#2-runtime-environment-node_env)
3. [Content Source: Preview vs Production Mode](#3-content-source-preview-vs-production-mode)
4. [Deployment Topology: Local vs Proxy Mode](#4-deployment-topology-local-vs-proxy-mode)
5. [isLocalDev Flag](#5-islocaldev-flag)
6. [Cache TTL Differences](#6-cache-ttl-differences)
7. [HMR and File Watching](#7-hmr-and-file-watching)
8. [Error Handling Differences](#8-error-handling-differences)
9. [Logging Behavior](#9-logging-behavior)
10. [Framework Root Path Issues](#10-framework-root-path-issues)
11. [Comprehensive Mode Matrix](#11-comprehensive-mode-matrix)
12. [Risk Analysis](#12-risk-analysis)
13. [Success Criteria](#13-success-criteria)

---

## 1. Mode Classification

### The Three Axes

```
                    NODE_ENV
                    ├── development (isLocalDev=true, verbose errors, no minify)
                    ├── production (isLocalDev=false, minimal errors, minify)
                    └── test (special test handling)

                    Content Source (productionMode)
                    ├── false (Preview): Fetches from branch/draft content
                    └── true (Production): Fetches from releases, requires releaseId

                    Deployment Topology (proxyMode)
                    ├── false (Local): Direct filesystem or API access
                    └── true (Proxy): Token/headers passed from proxy layer
```

### Domain-Based Environment Detection

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/server/utils/domain-parser.ts`

```typescript
// Lines 74-107: Domain patterns determine environment
// Local development preview: {slug}.preview.{lvh.me|veryfront.dev}
const localPreviewMatch = domain.match(
  new RegExp(`^([A-Za-z0-9-]+)\\.preview\\.(${LOCAL_DEV_DOMAINS})$`),
);
if (localPreviewMatch?.[1]) {
  const { slug, branch } = parseSlugAndBranch(localPreviewMatch[1]);
  return createParsedDomain(slug, branch, "preview", true, true); // isDraft=true
}

// Local development base: {slug}.{lvh.me|veryfront.dev}
// Mirrors production behavior: serves released content (isDraft: false)
const localBaseMatch = domain.match(new RegExp(`^([A-Za-z0-9-]+)\\.(${LOCAL_DEV_DOMAINS})$`));
if (localBaseMatch?.[1]) {
  const { slug, branch } = parseSlugAndBranch(localBaseMatch[1]);
  return createParsedDomain(slug, branch, "production", true, false); // isDraft=false
}
```

**Risk:** Domain pattern determines `isDraft` which affects content fetching, but `NODE_ENV` is separate.

---

## 2. Runtime Environment: NODE_ENV

### Definition Sources

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/utils/logger/env.ts`

```typescript
// Lines 22-32: Environment detection
export function isTestEnvironment(): boolean {
  return getEnvironmentVariable("NODE_ENV") === "test";
}

export function isProductionEnvironment(): boolean {
  return getEnvironmentVariable("NODE_ENV") === "production";
}

export function isDevelopmentEnvironment(): boolean {
  return (getEnvironmentVariable("NODE_ENV") ?? "development") === "development";
}
```

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/server/context/request-context.ts`

```typescript
// Lines 8-11: EnvConfig creation
export function createEnvConfig(): EnvConfig {
  const env = getEnv("NODE_ENV") ?? getEnv("DENO_ENV") ?? "development";
  return { isLocalDev: env !== "production" };
}
```

**Risk:** Default is `development`, not `production`. If `NODE_ENV` is unset in production pods, `isLocalDev` will incorrectly be `true`.

### Build Configuration Differences

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/build/config/environment.ts`

```typescript
// Lines 40-58: Build config varies by environment
export function getBuildConfig(): BuildEnvironmentConfig {
  const environment = getEnvironment();
  const isDevelopment = environment === "development";
  const isProduction = environment === "production";

  return {
    environment,
    isDevelopment,
    isProduction,
    cacheMaxEntries: isDevelopment ? 10 : 100,        // 10x more cache in prod
    cacheTTLMs: isDevelopment ? 0 : 3600000,          // No TTL in dev, 1hr in prod
    minify: isProduction,                              // Only minify in prod
    sourcemaps: isDevelopment ? "inline" : false,      // Sourcemaps only in dev
    treeShaking: isProduction,                         // Tree shake only in prod
    target: isProduction ? ["es2020"] : ["esnext"],   // Different build targets
  };
}
```

| Setting | Development | Production |
|---------|-------------|------------|
| `cacheMaxEntries` | 10 | 100 |
| `cacheTTLMs` | 0 (no cache) | 3600000 (1 hour) |
| `minify` | false | true |
| `sourcemaps` | "inline" | false |
| `treeShaking` | false | true |
| `target` | ["esnext"] | ["es2020"] |

---

## 3. Content Source: Preview vs Production Mode

### Mode Determination

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/server/handlers/request/ssr/ssr-handler.ts`

```typescript
// Lines 50-62: Production mode determination
/**
 * Determine if request should serve production (released) content.
 * Uses resolvedEnvironment (from domain lookup) with fallback to requestContext.mode.
 * Config override (PRODUCTION_MODE) takes precedence.
 */
export function isProductionMode(ctx: HandlerContext, _url?: URL): boolean {
  if (ctx.config?.fs?.veryfront?.productionMode === true) {
    return true;  // Config override wins
  }

  const environment = ctx.resolvedEnvironment ?? ctx.requestContext?.mode;
  return environment === "production";
}
```

### Content Fetching Logic

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/platform/adapters/fs/veryfront/read-operations.ts`

```typescript
// Lines 231-362: Content fetching with mode-aware behavior
private async fetchContent(normalizedPath: string): Promise<string> {
  const isProduction = this.contextProvider?.isProductionMode() ?? false;

  // Line 265: Production uses persistent cache
  if (isProduction) {
    const cached = await this.cache.getAsync<string>(cacheKey);
    if (cached) {
      setRequestScopedFile(cacheKey, cached);
      return cached;
    }
  }

  // Line 299-313: Skip file list cache for preview mode
  const isPreviewMode = ctx?.sourceType === "branch";
  if (!skipPersistentCaches && !isPreviewMode) {
    const fileListContent = await this.getContentFromFileList(normalizedPath);
    if (fileListContent) {
      if (isProduction) this.cache.set(cacheKey, fileListContent);
      return fileListContent;
    }
  } else if (isPreviewMode) {
    logger.debug("[ReadOperations] Skipping file list cache for preview mode");
  }

  // Line 333-354: Different fetch paths
  const isPublished = ctx?.sourceType !== "branch";
  if (isPublished) {
    return await this.fetchPublishedContent(...);  // Fetches from /environments/ or /releases/
  }
  return await this.fetchDraftContent(...);        // Fetches from /branches/
}
```

### Content Source ID Computation

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/cache/keys.ts`

```typescript
// Lines 110-126: Single source of truth for cache isolation
export function computeContentSourceId(
  isLocalDev: boolean,
  environment: "preview" | "production",
  branch: string | null | undefined,
  releaseId: string | null | undefined,
): string {
  if (isLocalDev) {
    return `local-${branch ?? "main"}`;      // Local: "local-main"
  }
  if (environment === "production") {
    if (!releaseId) {
      throw new Error("Missing releaseId for production contentSourceId");
    }
    return `release-${releaseId}`;           // Production: "release-abc123"
  }
  return `preview-${branch ?? "main"}`;      // Preview: "preview-main"
}
```

**Risk:** If `releaseId` is missing in production mode, this throws an error. This can happen if:
- Domain routes to production but proxy doesn't pass `x-release-id` header
- Standalone mode without explicit release configuration

---

## 4. Deployment Topology: Local vs Proxy Mode

### Proxy Mode Detection

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/utils/constants/cache.ts`

```typescript
// Lines 31-35: Multiple signals for production mode
function isProductionMode(): boolean {
  return getEnvString("PROXY_MODE") === "1" ||
    getEnvString("NODE_ENV") === "production" ||
    getEnvString("PRODUCTION_MODE") === "1";
}
```

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/server/universal-handler/index.ts`

```typescript
// Line 246: Config-based proxy mode detection
const isProxyMode = opts.config?.fs?.veryfront?.proxyMode === true;
```

### Proxy Mode Effects

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/server/shared/renderer/adapter.ts`

```typescript
// Lines 59-91: Proxy mode changes cache backend
async function getOrInitRenderer(): Promise<Renderer> {
  const isProxyMode = getEnv("PROXY_MODE") === "1";
  const options: RendererOptions = {};

  if (isProxyMode) {
    const renderCacheTtlSeconds = 3600;
    logger.debug("[RendererAdapter] Using API-backed distributed render cache");
    options.cache = {
      store: new APICacheStore({
        keyPrefix: "render",
        ttlSeconds: renderCacheTtlSeconds,
        localMaxEntries: 200,
        enableLocalCache: false,  // Disable local cache in proxy mode
      }),
      ttlMs: renderCacheTtlSeconds * 1000,
    };
  }
}
```

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/cache/backend.ts`

```typescript
// Lines 530-540: Distributed cache initialization
const proxyMode = getEnvDirect("PROXY_MODE");
const nodeEnv = getEnvDirect("NODE_ENV");
const apiUrl = getEnvDirect("VERYFRONT_API_BASE_URL");

const isProduction = proxyMode === "1" ||
  nodeEnv === "production" ||
  getEnvDirect("PRODUCTION_MODE") === "1";

return isProduction && !!apiUrl;  // Only use distributed cache in production with API URL
```

---

## 5. isLocalDev Flag

### Sources of Truth

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/server/context/request-context.ts`

```typescript
// Lines 4-11: Default creation
export interface EnvConfig {
  isLocalDev: boolean;
}

export function createEnvConfig(): EnvConfig {
  const env = getEnv("NODE_ENV") ?? getEnv("DENO_ENV") ?? "development";
  return { isLocalDev: env !== "production" };
}
```

### Usage Throughout Codebase

| File | Line | Usage |
|------|------|-------|
| `src/server/handlers/preview/hmr-handler.ts` | 168 | `const isLocalDev = ctx.requestContext?.isLocalDev === true;` |
| `src/server/handlers/preview/markdown-preview-handler.ts` | 30 | Only enabled if `isLocalDev` or preview mode |
| `src/server/handlers/request/ssr/ssr-handler.ts` | 321 | ETag caching disabled in dev |
| `src/server/handlers/request/ssr/ssr-handler.ts` | 439 | Error overlay shown in dev/preview |
| `src/server/handlers/dev/dashboard/index.ts` | 14 | Dev dashboard only enabled if `isLocalDev` |
| `src/server/handlers/dev/debug-context.ts` | 22 | Debug endpoints only in dev |
| `src/server/handlers/request/rsc/handlers/render-handler.ts` | 90 | RSC payload optimization skipped in dev |
| `src/rendering/context/render-context.ts` | 63-80 | Mode determination |
| `src/cache/keys.ts` | 116-117 | Content source ID prefixed with "local-" |

### Behavior Differences

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/server/context/enriched-context.ts`

```typescript
// Lines 124-138: Cache strategy based on isLocalDev
export function shouldEnableCacheFromEnriched(enriched: EnrichedContext): boolean {
  return !enriched.isLocalDev && enriched.environment !== "preview";
}

export function shouldUseNoCacheHeadersFromEnriched(enriched: EnrichedContext): boolean {
  return enriched.isLocalDev || enriched.environment === "preview";
}
```

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/server/context/request-context.ts`

```typescript
// Lines 52-66: Cache strategy
export function getCacheStrategy(ctx: RequestContext): "none" | "invalidate" | "immutable" {
  if (ctx.isLocalDev) return "none";        // No caching in local dev
  if (ctx.mode === "preview") return "invalidate";  // Invalidation-based in preview
  return "immutable";                        // Immutable caching in production
}
```

---

## 6. Cache TTL Differences

### Distributed Cache TTLs

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/utils/constants/cache.ts`

```typescript
// Lines 68-127: Environment-aware TTLs
// Production: longer TTLs (release content is immutable)
// Preview: shorter TTLs (branch content changes frequently)

export const DISTRIBUTED_SSR_MODULE_TTL_PRODUCTION_SEC = 6 * 60 * 60;  // 6 hours
export const DISTRIBUTED_SSR_MODULE_TTL_PREVIEW_SEC = 10 * 60;         // 10 minutes

export const DISTRIBUTED_TRANSFORM_TTL_PRODUCTION_SEC = 6 * 60 * 60;   // 6 hours
export const DISTRIBUTED_TRANSFORM_TTL_PREVIEW_SEC = 10 * 60;          // 10 minutes

export const DISTRIBUTED_FILE_TTL_PRODUCTION_SEC = 60 * 60;            // 1 hour
export const DISTRIBUTED_FILE_TTL_PREVIEW_SEC = 5 * 60;                // 5 minutes

export const DISTRIBUTED_CSS_TTL_PRODUCTION_SEC = 6 * 60 * 60;         // 6 hours
export const DISTRIBUTED_CSS_TTL_PREVIEW_SEC = 10 * 60;                // 10 minutes

/** Get environment-aware distributed cache TTL in seconds */
export function getDistributedCacheTTL(
  cacheType: "ssr-module" | "transform" | "file" | "css",
  isProduction: boolean = isProductionMode(),
): number {
  switch (cacheType) {
    case "ssr-module":
      return isProduction
        ? DISTRIBUTED_SSR_MODULE_TTL_PRODUCTION_SEC
        : DISTRIBUTED_SSR_MODULE_TTL_PREVIEW_SEC;
    // ... etc
  }
}
```

### TTL Comparison Table

| Cache Type | Production TTL | Preview TTL | Ratio |
|------------|---------------|-------------|-------|
| SSR Module | 6 hours | 10 minutes | 36x |
| Transform | 6 hours | 10 minutes | 36x |
| File | 1 hour | 5 minutes | 12x |
| CSS | 6 hours | 10 minutes | 36x |
| Build Cache | 1 day | 5 minutes | 288x |
| Bundle Manifest | 7 days | 1 hour | 168x |

**Risk:** Preview mode's short TTLs are fine, but if a production request is misclassified as preview, cache efficiency drops 36x.

---

## 7. HMR and File Watching

### HMR Handler Conditions

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/server/handlers/preview/hmr-handler.ts`

```typescript
// Lines 162-177: HMR only in preview or local dev
handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
  const queryEnv = url.searchParams.get("x-environment");
  const isPreviewMode = ctx.requestContext?.mode === "preview" || queryEnv === "preview";
  const isLocalDev = ctx.requestContext?.isLocalDev === true;

  if (!isPreviewMode && !isLocalDev) {
    logger.debug("[HMRHandler] Skipping - not preview or local dev", {
      mode: ctx.requestContext?.mode,
      queryEnv,
      isLocalDev,
    });
    return Promise.resolve(this.continue());
  }
  // ... HMR handling
}
```

### File Watcher (Dev Only)

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/platform/adapters/runtime/node/filesystem-adapter.ts`

```typescript
// Lines 88-133: File watching only available in Node/Deno
watch(paths: string | string[], options?: WatchOptions): FileWatcher {
  const normalizedPaths = Array.isArray(paths) ? paths : [paths];
  const onChange = options?.onChange;
  const watchers: Array<import("node:fs").FSWatcher> = [];

  for (const path of normalizedPaths) {
    // ... setup fs.watch
  }
  // ... cleanup logic
}
```

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/platform/adapters/fs/wrapper.ts`

```typescript
// Lines 246-248: Throws in unsupported adapters
watch(_paths: string | string[], _options?: WatchOptions): FileWatcher {
  throw new NotSupportedError("watch", this._fsAdapter.constructor.name);
}
```

**Risk:** File watching is not available on all adapters. Production pods using different filesystem adapters cannot use HMR even if accidentally enabled.

---

## 8. Error Handling Differences

### API Route Error Handling

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/routing/api/error-handler.ts`

```typescript
// Lines 1-34: Error response varies by environment
function isDevelopment(adapter: RuntimeAdapter): boolean {
  const env = adapter.env.get("MODE") ??
    adapter.env.get("NODE_ENV") ??
    adapter.env.get("DENO_ENV");

  if (!env) return isDevelopmentEnvironment();

  const normalized = env.toLowerCase();
  return normalized === "development" || normalized === "dev";
}

export function handleAPIError(
  error: unknown,
  pathname: string,
  adapter: RuntimeAdapter,
): Response {
  logger.error(`API route error in ${pathname}:`, error);

  if (!isDevelopment(adapter)) return internalServerError();  // Generic 500

  const err = error instanceof Error ? error : undefined;

  return jsonResponse(
    {
      error: err?.message ?? "Internal server error",
      stack: err?.stack,  // Stack trace exposed in dev
    },
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}
```

### SSR Error Handling

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/server/handlers/request/ssr/ssr-handler.ts`

```typescript
// Lines 437-449: Error overlay in dev/preview
if (
  !isHead &&
  (ctx.requestContext?.isLocalDev || ctx.requestContext?.mode === "preview")
) {
  const body = ErrorOverlay.createHTML({ error: errorObj, type: "runtime" });
  return this.respond(
    builder
      .withCache("no-cache")
      .withContentType(getContentType(".html"), body, HTTP_INTERNAL_SERVER_ERROR),
  );
}

// Lines 451-468: Generic error page in production
const customErrorResponse = await tryErrorPageFallback(req, ctx, builder, {
  statusCode: HTTP_INTERNAL_SERVER_ERROR,
  error: errorObj,
  pathname: slug || "/",
});
if (customErrorResponse) {
  return this.respond(customErrorResponse);
}

const body = isHead ? null : ErrorPages.serverError();  // Generic error page
```

### RSC Error Handling

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/server/handlers/request/rsc/handlers/render-handler.ts`

```typescript
// Lines 110-137: Error detail based on isLocalDev
const isProd = !this.isLocalDev;

// Line 137: Stack trace only in dev
stack: this.isLocalDev ? normalizedError.stack : undefined,
```

---

## 9. Logging Behavior

### Log Format by Environment

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/utils/logger/logger.ts`

```typescript
// Lines 115-121: Log format determination
function getDefaultFormat(
  envFormat: string | undefined = getEnvironmentVariable("LOG_FORMAT"),
  envMode: string | undefined = getEnvironmentVariable("NODE_ENV"),
): LogFormat {
  if (envFormat === "json" || envFormat === "text") return envFormat;
  return envMode === "production" ? "json" : "text";  // JSON for Grafana in prod
}
```

### Log Level by Environment

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/utils/logger/logger.ts`

```typescript
// Lines 82-109: Log level determination
function resolveLoggerConfig(): LoggerConfig {
  const envLevel = getEnvironmentVariable("LOG_LEVEL");
  const debugFlag = getEnvironmentVariable("VERYFRONT_DEBUG");
  const envFormat = getEnvironmentVariable("LOG_FORMAT");
  const envMode = getEnvironmentVariable("NODE_ENV");

  cachedConfig = {
    level: getDefaultLevel(envLevel, debugFlag),  // DEBUG if VERYFRONT_DEBUG set
    format: getDefaultFormat(envFormat, envMode),
  };

  return cachedConfig;
}
```

### Browser Logger

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/rendering/client/browser-logger.ts`

```typescript
// Lines 53-56: Client-side logging level
const isDevelopment = g.__VERYFRONT_DEV__ || g.__RSC_DEV__;
if (!isDevelopment) return LogLevel.WARN;  // Only WARN+ in production
```

---

## 10. Framework Root Path Issues

### FRAMEWORK_ROOT Definition

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/transforms/mdx/esm-module-loader/constants.ts`

```typescript
// Line 5: Computed from import.meta.url
export const FRAMEWORK_ROOT = new URL("../../../..", import.meta.url).pathname;
```

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/modules/server/module-server.ts`

```typescript
// Line 355: Same computation
const FRAMEWORK_ROOT = new URL("../../..", import.meta.url).pathname;
```

### Path Mismatch Validation

**File:** `/Users/mattboon/Sites/veryfront-renderer/src/transforms/mdx/esm-module-loader/module-fetcher/index.ts`

```typescript
// Lines 95-153: Framework path validation
/**
 * 1. Framework source paths (file:///app/src/...) that don't match FRAMEWORK_ROOT
 */

// Lines 146-153: Mismatch detection
if (!path.startsWith(FRAMEWORK_ROOT)) {
  logger.warn("[ModuleFetcher] Framework path mismatch - cache invalidation needed", {
    path,
    expectedRoot: FRAMEWORK_ROOT,
  });
  // Invalidate and re-transform
}
```

**Risk:** `FRAMEWORK_ROOT` varies based on:
- Local dev: `/Users/mattboon/Sites/veryfront-renderer/src/...`
- Production pod: `/app/src/...`
- Different pods: Could have slight variations

If transform cache contains absolute paths from one environment, they're invalid in another.

---

## 11. Comprehensive Mode Matrix

### Mode Combinations

| NODE_ENV | proxyMode | productionMode | isLocalDev | Content Source | Cache Strategy | HMR | Error Detail |
|----------|-----------|----------------|------------|----------------|----------------|-----|--------------|
| development | false | false | true | branch/draft | none | Yes | Full |
| development | false | true | true | release | none | Yes | Full |
| development | true | false | true | branch/draft | none | Yes | Full |
| development | true | true | true | release | none | Yes | Full |
| production | false | false | false | branch/draft | invalidate | No | Minimal |
| production | false | true | false | release | immutable | No | Minimal |
| production | true | false | false | branch/draft | invalidate | No | Minimal |
| production | true | true | false | release | immutable | No | Minimal |

### Feature Availability by Mode

| Feature | Local Dev | Preview (Remote) | Production (Remote) |
|---------|-----------|------------------|---------------------|
| HMR WebSocket | Yes | Yes | No |
| File Watching | Yes | No | No |
| Error Overlay | Yes | Yes | No |
| Stack Traces in Response | Yes | Yes | No |
| Dev Dashboard | Yes | No | No |
| Debug Endpoints | Yes | No | No |
| ETag/304 Responses | No | Yes | Yes |
| Distributed Cache | No | Yes | Yes |
| Short TTLs | N/A | Yes | No |
| Content from Releases | Optional | No | Yes (required) |
| releaseId Required | No | No | Yes |

### Domain-to-Mode Mapping

| Domain Pattern | Environment | isDraft | Content Source |
|----------------|-------------|---------|----------------|
| `{slug}.preview.veryfront.com` | preview | true | branch |
| `{slug}.veryfront.com` | production | false | release |
| `{slug}.preview.lvh.me` | preview | true | branch |
| `{slug}.lvh.me` | production | false | release |
| `localhost` | development | true | local filesystem |

---

## 12. Risk Analysis

### Critical Risks

#### 1. Missing NODE_ENV in Production

**Impact:** High
**Symptom:** `isLocalDev` becomes `true`, enabling dev features in production.

```typescript
// src/server/context/request-context.ts:9
const env = getEnv("NODE_ENV") ?? getEnv("DENO_ENV") ?? "development";  // Defaults to dev!
return { isLocalDev: env !== "production" };
```

**Mitigation:** Ensure `NODE_ENV=production` is set in all production pod configurations.

#### 2. Missing releaseId in Production Mode

**Impact:** High
**Symptom:** 500 error or falls back to preview content.

```typescript
// src/cache/keys.ts:120-122
if (environment === "production") {
  if (!releaseId) {
    throw new Error("Missing releaseId for production contentSourceId");
  }
}
```

**Mitigation:** Proxy must always pass `x-release-id` header for production requests.

#### 3. FRAMEWORK_ROOT Path Mismatch

**Impact:** Medium
**Symptom:** Module cache misses, transform errors in production.

```typescript
// Different paths in different environments
// Local: /Users/mattboon/Sites/veryfront-renderer/src/...
// Pod:   /app/src/...
```

**Mitigation:** Transform cache keys should not embed absolute paths, or should be environment-aware.

#### 4. Cache TTL Mismatch

**Impact:** Medium
**Symptom:** Stale content in preview, or excessive cache misses in production.

```typescript
// If production request is misclassified as preview:
// TTL drops from 6 hours to 10 minutes (36x reduction)
```

**Mitigation:** Ensure `productionMode` flag is correctly propagated through proxy headers.

#### 5. HMR Enabled in Production

**Impact:** Low
**Symptom:** WebSocket connections attempted, potential resource waste.

```typescript
// HMR only enabled when isPreviewMode || isLocalDev
if (!isPreviewMode && !isLocalDev) {
  return Promise.resolve(this.continue());  // Skip HMR
}
```

**Mitigation:** Current logic is safe, but ensure `isLocalDev` is never true in production.

### Configuration Precedence Issues

The system has multiple overlapping configuration sources:

1. Environment variables: `NODE_ENV`, `PROXY_MODE`, `PRODUCTION_MODE`
2. Config file: `veryfront.config.ts` with `fs.veryfront.productionMode`
3. Request headers: `x-environment`, `x-release-id`
4. Domain parsing: `{slug}.preview.veryfront.com`

**Precedence (highest to lowest):**
1. Config file override (`productionMode: true`)
2. Request headers (`x-environment`)
3. Domain parsing
4. Environment variables
5. Defaults

---

## 13. Success Criteria

### Unified Behavior Requirements

1. **Single Source of Truth for Mode**
   - [ ] Create a `ModeResolver` service that consolidates all mode signals
   - [ ] Document precedence order explicitly
   - [ ] Add logging when mode sources conflict

2. **Explicit Mode Propagation**
   - [ ] Proxy must always pass: `x-environment`, `x-release-id`, `x-content-source-id`
   - [ ] Renderer should fail fast if required headers missing in proxy mode
   - [ ] Add validation middleware for mode consistency

3. **Environment Validation**
   - [ ] Add startup check: Fail if `NODE_ENV` is unset in proxy mode
   - [ ] Warn if `PRODUCTION_MODE=1` but `releaseId` is missing
   - [ ] Log effective mode configuration at startup

4. **Cache Path Normalization**
   - [ ] Remove absolute paths from transform cache keys
   - [ ] Use content hashes instead of file paths where possible
   - [ ] Add environment prefix to distributed cache keys

5. **Testing Coverage**
   - [ ] Integration tests for each mode combination
   - [ ] Tests that verify mode-specific behavior (TTLs, error handling, HMR)
   - [ ] Tests that simulate mode mismatches

### Validation Checklist

```
Pre-Deployment Checklist:
[ ] NODE_ENV=production in all production pod specs
[ ] PROXY_MODE=1 for renderer pods in proxy architecture
[ ] PRODUCTION_MODE=1 only when serving releases
[ ] x-release-id header passed for all production requests
[ ] x-environment header matches domain environment
[ ] Distributed cache backend configured (Redis/API)
[ ] VERYFRONT_API_BASE_URL set for distributed cache
```

### Monitoring Recommendations

1. **Metric: Mode Classification Accuracy**
   - Track `contentSourceId` prefix distribution
   - Alert if production requests get "preview-" or "local-" prefix

2. **Metric: Cache Hit Rates by Mode**
   - Separate metrics for production vs preview
   - Alert if production hit rate drops below threshold

3. **Metric: HMR Connection Attempts**
   - Should be zero in production environment
   - Alert on any production HMR connections

4. **Log: Mode Conflicts**
   - Log warning when mode signals disagree
   - Example: Domain says production, header says preview
