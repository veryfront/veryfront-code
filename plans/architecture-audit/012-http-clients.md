# HTTP Client Implementations Audit

## Executive Summary

The veryfront-renderer codebase contains **12+ distinct HTTP client implementations** with varying approaches to retry logic, timeout handling, error handling, and caching. This fragmentation creates maintenance burden, inconsistent behavior, and makes debugging network issues difficult.

**Impact**: High - HTTP client inconsistencies can cause production failures, hard-to-debug timeout issues, and inconsistent retry behavior across different parts of the system.

**Recommendation**: Create a unified HTTP client wrapper with pluggable middleware for retry, timeout, caching, and observability.

---

## Inventory: All HTTP Fetching Locations

### 1. Core API Clients

| File | Purpose | LOC |
|------|---------|-----|
| `src/platform/adapters/veryfront-api-client/retry-handler.ts` | Veryfront API requests | ~120 |
| `src/platform/adapters/token/veryfront/api-client.ts` | Token storage API | ~220 |
| `src/platform/adapters/fs/github/github-api-client.ts` | GitHub API | ~220 |
| `proxy/oauth-client.ts` | OAuth token requests | ~90 |
| `proxy/handler.ts` | Domain lookup | ~60 |

### 2. Module Fetching

| File | Purpose | LOC |
|------|---------|-----|
| `src/transforms/mdx/esm-module-loader/module-fetcher/index.ts` | MDX module HTTP fallback | ~40 |
| `src/transforms/esm/http-cache.ts` | HTTP module caching (esm.sh) | ~400 |
| `src/transforms/esm/http-bundler.ts` | esbuild HTTP plugin | ~150 |

### 3. Server & Utilities

| File | Purpose | LOC |
|------|---------|-----|
| `src/server/utils/domain-lookup.ts` | Domain resolution | ~180 |
| `src/cli/mcp/remote-file-tools.ts` | Remote file API | ~80 |
| `src/workflow/blob/gcs-storage.ts` | GCS blob storage | ~200 |

### 4. Client-Side

| File | Purpose | LOC |
|------|---------|-----|
| `src/rendering/client/prefetch/network-utils.ts` | Link prefetching | ~50 |
| `src/rendering/client/prefetch/prefetch-queue.ts` | Prefetch queue | ~30 |
| `src/agent/react/use-agent.ts` | Agent API calls | ~50 |

---

## Detailed Analysis

### 1. Veryfront API Client (`retry-handler.ts`)

**Location**: `/Users/mattboon/Sites/veryfront-renderer/src/platform/adapters/veryfront-api-client/retry-handler.ts`

**Features**:
- Configurable retry with exponential backoff
- OpenTelemetry tracing integration
- API metrics recording
- Token masking in logs

```typescript
// Retry Logic
export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
}

export async function requestWithRetry(
  url: string,
  apiToken: string,
  retryConfig: RetryConfig,
  options: RequestOptions = {},
): Promise<unknown> {
  const { maxRetries, initialDelay, maxDelay } = retryConfig;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await withSpan(SpanNames.HTTP_CLIENT_FETCH, async () => {
        const headers = new Headers({
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        });
        injectContext(headers);

        const response = await fetch(url, { headers });

        if (!response.ok) {
          throw new VeryfrontAPIError(
            `API request failed: ${response.status} ${response.statusText}`,
            response.status,
            { url, responseText: text },
          );
        }
        return { data: await response.json() };
      });
      return result.data;
    } catch (error) {
      // Don't retry 4xx errors (except 429)
      if (error instanceof VeryfrontAPIError) {
        const status = error.status;
        if (status && status >= 400 && status < 500 && status !== 429) {
          throw error;
        }
      }

      const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new VeryfrontAPIError(`API request failed after ${maxRetries} retries`);
}
```

**Timeout Handling**: NONE - No AbortController
**Caching**: NONE - Caller must implement

---

### 2. Token Storage API Client (`api-client.ts`)

**Location**: `/Users/mattboon/Sites/veryfront-renderer/src/platform/adapters/token/veryfront/api-client.ts`

**Features**:
- Retry with exponential backoff
- Context injection for tracing
- Custom error type

```typescript
private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  const { maxRetries, initialDelay, maxDelay } = this.config.retry;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const headers = new Headers(init.headers);
      injectContext(headers);

      const response = await fetch(url, { ...init, headers });

      // Don't retry 4xx (except 429)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        return response;
      }

      if (!response.ok && (response.status >= 500 || response.status === 429)) {
        throw new Error(`Server error: ${response.status}`);
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new TokenStorageError(
    `Request failed after ${maxRetries} retries: ${lastError?.message}`,
  );
}
```

**Timeout Handling**: NONE
**Caching**: NONE

---

### 3. GitHub API Client (`github-api-client.ts`)

**Location**: `/Users/mattboon/Sites/veryfront-renderer/src/platform/adapters/fs/github/github-api-client.ts`

**Features**:
- Retry with exponential backoff + jitter
- Rate limit awareness
- Specific error types per HTTP status

```typescript
private async request(endpoint: string): Promise<unknown> {
  const url = `${this.baseUrl}${endpoint}`;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= this.config.retry.maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "veryfront-renderer",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      this.updateRateLimitInfo(response);

      if (!response.ok) {
        throw this.createAPIError(response.status, errorBody, endpoint);
      }

      return await response.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry client errors (except rate limit)
      if (this.isClientError(lastError) && !this.isRateLimitError(lastError)) {
        throw lastError;
      }

      const delay = this.calculateRetryDelay(attempt, lastError);
      await this.sleep(delay);
    }
  }

  throw lastError ?? new Error("Request failed after retries");
}

private calculateRetryDelay(attempt: number, error: Error): number {
  // Special handling for rate limits - wait until reset
  if (this.isRateLimitError(error) && this.rateLimitInfo) {
    const waitMs = this.rateLimitInfo.reset.getTime() - Date.now();
    return Math.max(waitMs, this.config.retry.initialDelay);
  }

  const delay = Math.min(
    this.config.retry.initialDelay * Math.pow(2, attempt - 1),
    this.config.retry.maxDelay,
  );

  // Add jitter
  return delay + Math.random() * 1000;
}
```

**Timeout Handling**: NONE
**Caching**: External (caller implements)

---

### 4. OAuth Client (`proxy/oauth-client.ts`)

**Location**: `/Users/mattboon/Sites/veryfront-renderer/proxy/oauth-client.ts`

**Features**:
- AbortController timeout
- OpenTelemetry tracing
- Custom timeout error message

```typescript
const DEFAULT_TIMEOUT_MS = 10000;

export async function fetchOAuthToken(config: OAuthTokenConfig): Promise<TokenResponse> {
  return await withSpan(ProxySpanNames.OAUTH_TOKEN_REQUEST, async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    try {
      const headers = new Headers({ "Content-Type": "application/json" });
      injectContext(headers);

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({...}),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(`OAuth token request failed: ${response.status} - ${errorText}`);
      }

      return response.json();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`OAuth token request timed out after ${config.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  });
}
```

**Timeout Handling**: YES - 10s default
**Retry Logic**: NONE
**Caching**: External (TokenManager handles)

---

### 5. HTTP Module Cache (`http-cache.ts`)

**Location**: `/Users/mattboon/Sites/veryfront-renderer/src/transforms/esm/http-cache.ts`

**Features**:
- 30s timeout
- User-Agent spoofing
- Distributed cache (Redis) integration
- LRU memory cache
- File:// path rewriting

```typescript
async function cacheHttpModule(url: string, options: CacheOptions): Promise<string | null> {
  const normalizedUrl = normalizeHttpUrl(url);

  // Check local LRU cache
  const existing = cachedPaths.get(cacheKey);
  if (existing) return existing;

  // Check filesystem cache
  if (await exists(cachePath)) {
    cachedPaths.set(cacheKey, cachePath);
    return cachePath;
  }

  // Check distributed cache (Redis)
  const distributed = await getDistributedCache();
  if (distributed) {
    const cachedCode = await distributed.get(distributedKey("url", hash));
    if (cachedCode) {
      await fs.writeTextFile(cachePath, cachedCode);
      return cachePath;
    }
  }

  // Fetch from network
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const response = await withSpan(SpanNames.HTTP_CLIENT_FETCH, () =>
    fetch(normalizedUrl, {
      headers: { "user-agent": "Mozilla/5.0 Veryfront/1.0" },
      signal: controller.signal,
      redirect: "follow",
    })
  );
  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`Failed to fetch ${normalizedUrl}: ${response.status}`);
  }

  let code = await response.text();
  code = await rewriteModuleImports(code, normalizedUrl, options);

  // Cache to filesystem and distributed cache
  await fs.writeTextFile(cachePath, code);
  await distributed?.set(distributedKey("url", hash), code, TTL);

  return cachePath;
}
```

**Timeout Handling**: YES - 30s
**Retry Logic**: NONE
**Caching**: YES - 3 layers (LRU, filesystem, Redis)

---

### 6. GCS Blob Storage (`gcs-storage.ts`)

**Location**: `/Users/mattboon/Sites/veryfront-renderer/src/workflow/blob/gcs-storage.ts`

**Features**:
- JWT authentication
- Token caching
- Multiple operations (put, get, delete, stat)

```typescript
async getStream(id: string): Promise<ReadableStream | null> {
  const key = this.getKey(id);
  const token = await this.getAccessToken();
  const downloadUrl = `https://storage.googleapis.com/storage/v1/b/${this.config.bucket}/o/${key}?alt=media`;

  try {
    const response = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.status === 404) return null;

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Failed to download from GCS: ${response.status}`);
    }

    return response.body;
  } catch (e) {
    logger.error("[GCSBlobStorage] getStream error", e);
    throw e;
  }
}
```

**Timeout Handling**: NONE
**Retry Logic**: NONE
**Caching**: Token caching only

---

### 7. Domain Lookup (`domain-lookup.ts`)

**Location**: `/Users/mattboon/Sites/veryfront-renderer/src/server/utils/domain-lookup.ts`

**Features**:
- LRU cache with TTL
- In-flight request deduplication
- Tracing integration

```typescript
const DOMAIN_CACHE_TTL_MS = 60_000;
const inFlightRequests = new Map<string, Promise<DomainLookupResult | null>>();

export function lookupProjectByDomain(domain: string, config: DomainLookupConfig) {
  return withSpan("server.domainLookup.lookup", async () => {
    // Check cache
    const cached = domainCache.get(cacheKey);
    if (cached?.expiresAt > Date.now()) return cached.result;

    // Check in-flight
    const inFlight = inFlightRequests.get(cacheKey);
    if (inFlight) return inFlight;

    // Fetch
    const requestPromise = fetchDomainLookup(domain, config);
    inFlightRequests.set(cacheKey, requestPromise);

    try {
      const result = await requestPromise;
      domainCache.set(cacheKey, { result, expiresAt: Date.now() + DOMAIN_CACHE_TTL_MS });
      return result;
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  });
}

function fetchDomainLookup(domain: string, config: DomainLookupConfig) {
  return withSpan("server.domainLookup.fetch", async () => {
    const headers = new Headers({
      Authorization: `Bearer ${config.apiToken}`,
      Accept: "application/json",
    });
    injectContext(headers);

    const response = await fetch(url, { headers });

    if (!response.ok) return null;
    return response.json();
  });
}
```

**Timeout Handling**: NONE
**Retry Logic**: NONE
**Caching**: YES - LRU with TTL + deduplication

---

### 8. MCP Remote File Tools (`remote-file-tools.ts`)

**Location**: `/Users/mattboon/Sites/veryfront-renderer/src/cli/mcp/remote-file-tools.ts`

**Features**:
- Simple wrapper function
- Error message parsing

```typescript
async function apiRequest<T>(
  method: string,
  path: string,
  options: { body?: unknown; token?: string } = {},
): Promise<{ ok: boolean; data?: T; error?: string; status: number }> {
  const token = options.token ?? getApiToken();
  if (!token) return { ok: false, error: "No API token", status: 401 };

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { ok: false, error: errorMessage, status: response.status };
    }

    return { ok: true, data: await response.json(), status: response.status };
  } catch (error) {
    return { ok: false, error: error.message, status: 0 };
  }
}
```

**Timeout Handling**: NONE
**Retry Logic**: NONE
**Caching**: NONE

---

## Comparison Matrix

| Implementation | Retry | Timeout | Caching | Tracing | Backoff | Jitter |
|---------------|-------|---------|---------|---------|---------|--------|
| Veryfront API | YES | NO | NO | YES | Exponential | NO |
| Token Storage | YES | NO | NO | YES | Exponential | NO |
| GitHub API | YES | NO | External | NO | Exponential | YES |
| OAuth Client | NO | YES (10s) | External | YES | N/A | N/A |
| HTTP Cache | NO | YES (30s) | YES (3 layers) | YES | N/A | N/A |
| GCS Storage | NO | NO | Token only | NO | N/A | N/A |
| Domain Lookup | NO | NO | YES (LRU+TTL) | YES | N/A | N/A |
| MCP Tools | NO | NO | NO | NO | N/A | N/A |

---

## Duplication Analysis

### Retry Logic Duplication

**Pattern 1**: Exponential backoff (3 implementations)

```typescript
// veryfront-api-client/retry-handler.ts
const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);

// token/veryfront/api-client.ts
const delay = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);

// github/github-api-client.ts
const delay = Math.min(
  this.config.retry.initialDelay * Math.pow(2, attempt - 1),
  this.config.retry.maxDelay,
);
```

### Timeout Logic Duplication

**Pattern 2**: AbortController timeout (2 implementations)

```typescript
// proxy/oauth-client.ts
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), timeout);
// ... fetch with signal
clearTimeout(timeoutId);

// http-cache.ts
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30000);
// ... fetch with signal
clearTimeout(timeout);
```

### Error Classification Duplication

**Pattern 3**: 4xx vs 5xx handling (3 implementations)

```typescript
// All three check: status >= 400 && status < 500 && status !== 429
```

### Cache Key Generation

**Pattern 4**: Hash-based cache keys (2 implementations)

```typescript
// http-cache.ts
const distributedKey = (prefix: string, hash: string | number) => `${prefix}:${hash}`;

// Similar patterns in module-fetcher
```

---

## Issues Identified

### 1. Missing Timeouts

**6 of 8 implementations have NO timeout handling**, meaning:
- Requests can hang indefinitely
- Resource leaks in long-running processes
- No protection against slow external APIs

**Affected**:
- Veryfront API client
- Token Storage API
- GitHub API
- GCS Storage
- Domain Lookup
- MCP Remote Tools

### 2. Inconsistent Retry Behavior

- Some retry on all errors, some only on 5xx
- Different retry counts (3 vs configurable)
- Different backoff strategies (with/without jitter)
- Rate limit handling only in GitHub client

### 3. No Circuit Breaker

None of the implementations have circuit breaker logic to:
- Prevent thundering herd after failures
- Fast-fail when service is known to be down
- Graceful degradation

### 4. Inconsistent Observability

- Some have tracing, some don't
- Different span names
- Inconsistent attribute capture
- No unified metrics

### 5. Error Type Fragmentation

```typescript
// Different error types per client
VeryfrontAPIError  // veryfront-api-client
TokenStorageError  // token storage
APIError           // github (augmented Error)
Error              // others (generic)
```

---

## Success Criteria

A unified HTTP client should provide:

1. **Single Entry Point**: One `httpClient.fetch()` for all HTTP needs
2. **Configurable Middleware**: Pluggable retry, timeout, caching
3. **Consistent Timeouts**: Default timeout with per-request override
4. **Unified Retry Logic**: Single implementation with configurable policy
5. **Circuit Breaker**: Prevent cascade failures
6. **Observability**: Built-in tracing and metrics
7. **Type Safety**: Proper TypeScript types throughout
8. **Testability**: Easy to mock in tests

---

## Recommended Solution

### Architecture

```
                    +-----------------------+
                    |    httpClient.fetch() |
                    +-----------------------+
                              |
                    +---------v---------+
                    |   Middleware Chain |
                    +-------------------+
                              |
        +---------+-----------+-----------+---------+
        |         |           |           |         |
   +----v---+ +---v----+ +----v---+ +----v----+ +---v---+
   | Retry  | |Timeout | |Tracing | | Cache   | |Circuit|
   +--------+ +--------+ +--------+ +---------+ |Breaker|
        |         |           |           |     +-------+
        +---------+-----------+-----------+---------+
                              |
                    +---------v---------+
                    |    Native fetch   |
                    +-------------------+
```

### Unified Client Interface

```typescript
// src/http/client.ts
export interface HttpClientConfig {
  baseUrl?: string;
  timeout?: number;
  retry?: RetryConfig;
  cache?: CacheConfig;
  circuitBreaker?: CircuitBreakerConfig;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  retryOn: (status: number, error: Error) => boolean;
  backoff: 'exponential' | 'linear' | 'fixed';
  jitter: boolean;
}

export interface CacheConfig {
  enabled: boolean;
  ttl: number;
  storage: 'memory' | 'redis' | 'filesystem';
  keyGenerator?: (request: Request) => string;
}

export interface CircuitBreakerConfig {
  enabled: boolean;
  threshold: number;
  resetTimeout: number;
}

export function createHttpClient(config: HttpClientConfig): HttpClient {
  return {
    fetch: async <T>(url: string, options?: RequestInit & { json?: boolean }): Promise<T> => {
      return executeWithMiddleware(url, options, config);
    },
  };
}
```

### Middleware Implementation

```typescript
// src/http/middleware/retry.ts
export function createRetryMiddleware(config: RetryConfig): Middleware {
  return async (request, next) => {
    let lastError: Error;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        const response = await next(request);

        if (config.retryOn(response.status, null)) {
          throw new RetryableError(response);
        }

        return response;
      } catch (error) {
        lastError = error;

        if (!config.retryOn(0, error)) {
          throw error;
        }

        if (attempt < config.maxRetries) {
          const delay = calculateDelay(attempt, config);
          await sleep(delay);
        }
      }
    }

    throw lastError;
  };
}

function calculateDelay(attempt: number, config: RetryConfig): number {
  let delay: number;

  switch (config.backoff) {
    case 'exponential':
      delay = Math.min(config.initialDelay * Math.pow(2, attempt), config.maxDelay);
      break;
    case 'linear':
      delay = Math.min(config.initialDelay * (attempt + 1), config.maxDelay);
      break;
    case 'fixed':
      delay = config.initialDelay;
      break;
  }

  if (config.jitter) {
    delay += Math.random() * delay * 0.1;
  }

  return delay;
}
```

### Migration Path

#### Phase 1: Create Unified Client (Week 1)
1. Implement core `HttpClient` class
2. Implement retry middleware
3. Implement timeout middleware
4. Implement tracing middleware
5. Add comprehensive tests

#### Phase 2: Migrate Core Clients (Week 2)
1. Migrate `veryfront-api-client/retry-handler.ts`
2. Migrate `token/veryfront/api-client.ts`
3. Migrate `proxy/oauth-client.ts`
4. Migrate `github/github-api-client.ts`

#### Phase 3: Migrate Secondary Clients (Week 3)
1. Migrate `http-cache.ts`
2. Migrate `domain-lookup.ts`
3. Migrate `remote-file-tools.ts`
4. Migrate `gcs-storage.ts`

#### Phase 4: Add Advanced Features (Week 4)
1. Implement circuit breaker
2. Add cache middleware
3. Unified metrics
4. Documentation

---

## File Changes Required

### New Files

```
src/http/
  client.ts              # Main HttpClient class
  types.ts               # Type definitions
  middleware/
    index.ts             # Middleware exports
    retry.ts             # Retry middleware
    timeout.ts           # Timeout middleware
    tracing.ts           # OpenTelemetry middleware
    cache.ts             # Cache middleware
    circuit-breaker.ts   # Circuit breaker middleware
  errors.ts              # HttpError types
  utils.ts               # Helper functions
```

### Modified Files

```
src/platform/adapters/veryfront-api-client/
  retry-handler.ts       # Use new HttpClient

src/platform/adapters/token/veryfront/
  api-client.ts          # Use new HttpClient

src/platform/adapters/fs/github/
  github-api-client.ts   # Use new HttpClient

proxy/
  oauth-client.ts        # Use new HttpClient
  handler.ts             # Use new HttpClient

src/transforms/esm/
  http-cache.ts          # Use new HttpClient

src/server/utils/
  domain-lookup.ts       # Use new HttpClient

src/cli/mcp/
  remote-file-tools.ts   # Use new HttpClient

src/workflow/blob/
  gcs-storage.ts         # Use new HttpClient
```

---

## Estimated Effort

| Phase | Description | Effort |
|-------|-------------|--------|
| 1 | Create unified client | 3-4 days |
| 2 | Migrate core clients | 2-3 days |
| 3 | Migrate secondary clients | 2-3 days |
| 4 | Advanced features | 2-3 days |
| **Total** | | **9-13 days** |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing behavior | Medium | High | Comprehensive tests before migration |
| Performance regression | Low | Medium | Benchmark before/after |
| Incomplete migration | Medium | Low | Feature flags per client |
| Timeout value mismatches | Medium | Medium | Audit existing values, make configurable |

---

## References

- [RFC: HTTP Client Architecture](./plans/http-client-rfc.md) (to be created)
- [Node.js undici](https://github.com/nodejs/undici) - Reference implementation
- [got HTTP client](https://github.com/sindresorhus/got) - Feature inspiration
- [axios interceptors](https://axios-http.com/docs/interceptors) - Middleware pattern
