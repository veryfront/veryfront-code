# Chapter 009: Timeout Handling Inconsistencies

## Executive Summary

The veryfront-renderer has **80+ timeout-related values across 40+ files** with no coherent architecture. In a multi-tenant environment where one pod serves many projects, this creates cascading failure modes where one project's slow operation can block all other projects.

## Sub-Analyses

| Document | Severity | Issue |
|----------|----------|-------|
| [009.0 - Timeout Handling RFC](./009.0-timeout-handling-rfc.md) | - | Complete solution architecture |
| [009.1 - Global Semaphores](./009.1-global-semaphores-no-project-isolation.md) | CRITICAL | Shared semaphores allow one project to starve others |
| [009.2 - Fetch Without Timeout](./009.2-fetch-calls-without-timeout.md) | CRITICAL | 7+ fetch() calls can hang indefinitely |
| [009.3 - Hierarchy Violations](./009.3-timeout-hierarchy-violations.md) | HIGH | Child timeouts equal or exceed parent timeouts |
| [009.4 - In-Flight Map Leaks](./009.4-in-flight-maps-no-timeout-cleanup.md) | HIGH | Request tracking maps grow unbounded |
| [009.5 - Hardcoded Values](./009.5-hardcoded-timeout-values.md) | MEDIUM | Magic numbers scattered across codebase |
| [009.6 - Duplicate Definitions](./009.6-duplicate-timeout-definitions.md) | MEDIUM | Same constant with different values |

## Problem Statement

The veryfront-renderer codebase has **dozens of timeout values scattered across 50+ files** with:

1. **No timeout hierarchy**: Individual operations define their own timeouts independent of parent operations
2. **Hardcoded magic numbers**: Values like `30000`, `10000`, `5000` appear inline without explanation
3. **Inconsistent units**: Some values in milliseconds, others in seconds
4. **Duplicate definitions**: Same operation has different timeouts in different files
5. **Missing timeouts**: Critical async operations have no timeout protection
6. **No cascading defaults**: Child operations can exceed parent timeouts

This creates **non-deterministic failure modes** where:
- A 60s request timeout contains a 90s proxy timeout (impossible scenario)
- Module loading at 30s can exceed SSR timeout at 20s
- Tests use arbitrary timeouts unrelated to production values

## Complete Timeout Inventory

### A. Request Layer Timeouts

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `REQUEST_TIMEOUT_MS` | 60000ms | `middleware/builtin/timeout.ts` | Default request middleware timeout |
| `REQUEST_TIMEOUT_MS` | env-configurable | `server/universal-handler/index.ts` | Handler timeout (via `getTimeoutFromEnv()`) |
| `RENDERER_REQUEST_TIMEOUT_MS` | 90000ms | `proxy/main.ts` | Proxy->renderer request timeout |
| `WS_CONNECT_TIMEOUT_MS` | 30000ms | `proxy/main.ts` | WebSocket connection timeout |

**Issue**: Proxy timeout (90s) > request timeout (60s). If renderer takes 70s, proxy succeeds but request has already timed out.

### B. Render Pipeline Timeouts

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `RENDER_PIPELINE_TIMEOUT_MS` | 60000ms | `rendering/renderer.ts` | Master render timeout |
| `RENDER_ACQUIRE_TIMEOUT_MS` | 5000ms | `rendering/renderer.ts` | Semaphore acquisition |
| `MODULE_LOAD_TIMEOUT_MS` | 10000ms | `rendering/orchestrator/pipeline.ts` | Module loading |
| `DATA_FETCH_TIMEOUT_MS` | 15000ms | `rendering/orchestrator/pipeline.ts` | Data fetching stage |
| `SSR_RENDER_TIMEOUT_MS` | 20000ms | `rendering/orchestrator/pipeline.ts` | SSR rendering stage |
| `CSS_SSR_TIMEOUT_MS` | 5000ms | `rendering/orchestrator/pipeline.ts` | CSS generation |
| `SSR_TIMEOUT_MS` | 10000ms | `config/defaults.ts` | Default SSR timeout |
| `PAGE_DATA_TIMEOUT_MS` | 25000ms | `server/handlers/request/module/page-data-endpoint-handler.ts` | Page data endpoint |

**Issue**: Sum of stage timeouts (10+15+20=45s) < master timeout (60s), but stages run sequentially. Individual stages can fail before master timeout.

### C. Data Fetching Timeouts

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `DATA_FETCH_TIMEOUT_MS` | 10000ms | `config/defaults.ts` | Default data fetch timeout |
| `DATA_FETCH_TIMEOUT_MS` | 15000ms | `rendering/orchestrator/pipeline.ts` | Pipeline data fetch (duplicate!) |
| `REVALIDATION_TIMEOUT_MS` | 15000ms | `utils/constants/cache.ts` | Background revalidation |

**Issue**: Two different `DATA_FETCH_TIMEOUT_MS` values (10s vs 15s) in different files!

### D. Module Loading Timeouts

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `HTTP_MODULE_FETCH_TIMEOUT_MS` | 2500ms | `utils/constants/http.ts` | HTTP module fetch |
| `DEFAULT_HTTP_TIMEOUT_MS` | 30000ms | `transforms/esm/http-bundler.ts` | HTTP bundler fetch |
| `IN_PROGRESS_WAIT_TIMEOUT_MS` | 30000ms | `modules/react-loader/ssr-module-loader/constants.ts` | Wait for in-progress transform |
| `TRANSFORM_ACQUIRE_TIMEOUT_MS` | 500ms | `modules/react-loader/ssr-module-loader/constants.ts` | Transform semaphore |
| `IN_FLIGHT_REQUEST_TIMEOUT_MS` | 15000ms | `platform/adapters/fs/veryfront/read-operations.ts` | In-flight request cleanup |

**Issue**: `HTTP_MODULE_FETCH_TIMEOUT_MS` (2.5s) vs `DEFAULT_HTTP_TIMEOUT_MS` (30s) - 12x difference for similar operations!

### E. CLI & Auth Timeouts

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `DEFAULT_LOGIN_TIMEOUT_MS` | 120000ms | `cli/auth/constants.ts` | OAuth login flow |
| `FETCH_TIMEOUT_MS` | 2000ms | `cli/commands/doctor/server-checks.ts` | Health check fetch |
| `SHUTDOWN_TIMEOUT_MS` | 3000ms | `cli/ui/constants.ts` | CLI shutdown |
| `DEFAULT_SANDBOX_TIMEOUT_MS` | 5000ms | `security/sandbox/constants.ts` | Code sandbox execution |

### F. WebSocket & HMR Timeouts

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `HMR_RECONNECT_DELAY_MS` | 1000ms | `utils/constants/http.ts` | HMR reconnection delay |
| `HMR_RELOAD_DELAY_MS` | 1000ms | `utils/constants/http.ts` | HMR reload delay |
| `HMR_KEEP_ALIVE_INTERVAL_MS` | 30000ms | `utils/constants/http.ts` | HMR keep-alive |
| `WS_RECONNECT_DELAY_MS` | 5000ms | `platform/adapters/fs/veryfront/adapter.ts` | WebSocket reconnect |
| `WS_HEARTBEAT_INTERVAL_MS` | 60000ms | `platform/adapters/fs/veryfront/adapter.ts` | WebSocket heartbeat |
| `WS_HEARTBEAT_TIMEOUT_MS` | 300000ms | `platform/adapters/fs/veryfront/adapter.ts` | Heartbeat timeout (5 min!) |
| `PING_INTERVAL_MS` | 45000ms | `server/handlers/preview/hmr-handler.ts` | Preview ping interval |

### G. Cache TTL Values (timeout-adjacent)

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `MODULE_CACHE_TTL_MS` | 300000ms (5m) | `utils/constants/cache.ts` | Module cache TTL |
| `ESM_CACHE_TTL_MS` | 600000ms (10m) | `utils/constants/cache.ts` | ESM cache TTL |
| `SSR_MODULE_CACHE_TTL_MS` | 1800000ms (30m) | `modules/react-loader/ssr-module-loader/constants.ts` | SSR module cache |
| `REDIS_TTL_SECONDS` | 21600s (6h) | `modules/react-loader/ssr-module-loader/constants.ts` | Redis distributed cache |
| `HTTP_MODULE_DISTRIBUTED_TTL_SEC` | 86400s (24h) | `utils/constants/cache.ts` | HTTP module distributed cache |

### H. Workflow Timeouts

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `DEFAULT_STEP_TIMEOUT_MS` | 300000ms (5m) | `workflow/executor/step-executor.ts` | Workflow step timeout |
| `timeoutMs` | 300000ms | `agent/ai-defaults.ts` | Agent call timeout |

### I. Test Timeouts

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `TEST_TIMEOUTS.UNIT` | 5000ms | `tests/_helpers/constants.ts` | Unit test timeout |
| `TEST_TIMEOUTS.INTEGRATION` | 30000ms | `tests/_helpers/constants.ts` | Integration test timeout |
| `TEST_TIMEOUTS.E2E` | 60000ms | `tests/_helpers/constants.ts` | E2E test timeout |
| `TEST_TIMEOUTS.BUILD` | 120000ms | `tests/_helpers/constants.ts` | Build test timeout |
| `TEST_TIMEOUTS.SERVER_STARTUP` | 10000ms | `tests/_helpers/constants.ts` | Server startup timeout |

### J. Retry & Circuit Breaker Values

| Constant | Value | Location | Purpose |
|----------|-------|----------|---------|
| `resetTimeoutMs` | 30000ms | `utils/circuit-breaker.ts` | Circuit breaker reset |
| `DEFAULT_RETRY_INITIAL_DELAY_MS` | 100ms | `utils/constants/retry.ts` | Retry initial delay |
| `DEFAULT_RETRY_MAX_DELAY_MS` | 5000ms | `utils/constants/retry.ts` | Retry max delay |
| `API_RETRY_INITIAL_DELAY_MS` | 1000ms | `utils/constants/retry.ts` | API retry initial delay |
| `API_RETRY_MAX_DELAY_MS` | 10000ms | `utils/constants/retry.ts` | API retry max delay |
| `WS_RECONNECT_INITIAL_DELAY_MS` | 1000ms | `utils/constants/retry.ts` | WS reconnect initial delay |
| `WS_RECONNECT_MAX_DELAY_MS` | 30000ms | `utils/constants/retry.ts` | WS reconnect max delay |

## Categories of Timeout Issues

### 1. Duplicate Definitions with Different Values

```typescript
// config/defaults.ts
export const DATA_FETCH_TIMEOUT_MS = 10000;

// rendering/orchestrator/pipeline.ts
const DATA_FETCH_TIMEOUT_MS = 15_000;  // DIFFERENT VALUE!
```

Both claim to be the data fetch timeout, but one is 10s and one is 15s.

### 2. Hardcoded Magic Numbers

```typescript
// proxy/main.ts
const RENDERER_REQUEST_TIMEOUT_MS = parseInt(getEnv("RENDERER_REQUEST_TIMEOUT_MS") || "90000");

// transforms/esm/http-cache.ts
const timeout = setTimeout(() => controller.abort(), 30000);  // Hardcoded!

// rendering/rsc/client-boot.ts
new Promise((_, reject) => setTimeout(() => reject(new Error('Hydration timeout')), 10000))  // Hardcoded!
```

### 3. Parent-Child Timeout Violations

```
Request Timeout (60s)
  |
  +-- Render Pipeline Timeout (60s) -- EQUAL, NO MARGIN!
        |
        +-- Module Load (10s)
        +-- Data Fetch (15s)
        +-- SSR Render (20s)
        +-- [Total: 45s, but could retry]
```

If render pipeline uses all 60s, the request timeout triggers simultaneously - race condition!

### 4. Inconsistent Units

```typescript
// Seconds
export const HTTP_CACHE_LONG_MAX_AGE_SEC = 31536000;
export const SERVER_ACTION_DEFAULT_TTL_SEC = 3600;

// Milliseconds
export const SSR_TIMEOUT_MS = 10000;
export const DATA_FETCH_TIMEOUT_MS = 10000;

// Raw numbers (what unit?)
const timeout = 30000;  // Is this ms? seconds?
```

### 5. Missing Timeouts on Critical Paths

```typescript
// Many fetch() calls without timeout:
const response = await fetch(url);  // No AbortController timeout!

// Database operations without timeout
const result = await redis.get(key);  // Could hang forever!
```

## Code Examples of Anti-Patterns

### Anti-Pattern 1: Inline Hardcoded Timeouts

```typescript
// src/rendering/utils/stream-utils.ts
export async function streamToString(
  stream: ReadableStream,
  timeoutMs: number = SSR_TIMEOUT_MS,  // Default is 10s
): Promise<string> {
  // ...
  const timeoutId = setTimeout(() => {
    reader.cancel("Stream read timeout").catch(() => {});
  }, timeoutMs);
```

Good: Uses constant. Bad: Default doesn't match actual use cases.

### Anti-Pattern 2: Environment Variable with Hardcoded Fallback

```typescript
// proxy/main.ts
const RENDERER_REQUEST_TIMEOUT_MS = parseInt(getEnv("RENDERER_REQUEST_TIMEOUT_MS") || "90000");
```

The "90000" fallback is a magic number with no connection to other timeouts.

### Anti-Pattern 3: Timeout in String Template

```typescript
// server/handlers/dev/dashboard/api.ts
const timeoutMs = 30000; // 30 seconds timeout for dev testing
// ...
setTimeout(() => reject(new Error("Workflow execution timed out (30s)")), timeoutMs)
```

Comment and code both hardcode "30" - if changed, they'll diverge.

### Anti-Pattern 4: Client-Side Hardcoded Timeout

```typescript
// html/hydration-script-builder/templates/router.ts
const FETCH_TIMEOUT_MS = 10000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
// ...
new Promise((_, reject) => setTimeout(() => reject(new Error('Hydration timeout')), 10000))
```

Client JS bundles hardcoded values that can't be configured at runtime.

## Specific Issues

### Issue 1: No Timeout Hierarchy

There's no concept of:
```
MASTER_TIMEOUT > STAGE_TIMEOUT > OPERATION_TIMEOUT
```

Each operation picks its own timeout independently.

### Issue 2: Race Conditions Between Layers

```
Proxy: 90s timeout
  -> Request: 60s timeout
    -> Render: 60s timeout
```

If render takes 61s:
1. Render timeout fires at 60s
2. Request timeout fires at 60s (race!)
3. Proxy continues waiting for 29 more seconds

### Issue 3: Retry Loops Can Exceed Parent Timeouts

```typescript
// Example: 3 retries with exponential backoff
// initialDelay: 1000ms, maxDelay: 30000ms
// Retry 1: wait 1s, Retry 2: wait 2s, Retry 3: wait 4s
// Total retry time could be 7s + operation time
```

No guarantee that retries complete before parent timeout.

### Issue 4: Test vs Production Mismatch

```typescript
// Tests use:
TEST_TIMEOUTS.INTEGRATION = 30_000

// Production uses:
REQUEST_TIMEOUT_MS = 60_000
```

Tests pass with 30s timeout, but production allows 60s - behavior differs.

## Success Criteria

1. **Single source of truth**: All timeout values defined in `src/utils/constants/timeouts.ts`
2. **Timeout hierarchy**: Clear parent-child relationships with safety margins
3. **Type safety**: Distinct types for `MillisecondTimeout` vs `SecondTimeout`
4. **Cascading defaults**: Child timeouts automatically computed from parent
5. **Runtime validation**: Startup check that child < parent - margin
6. **Documentation**: Each timeout explains why that specific value

## Recommended Solution

### 1. Unified Timeout Configuration

```typescript
// src/utils/constants/timeouts.ts

// Base unit types for type safety
export type Milliseconds = number & { readonly __brand: 'ms' };
export type Seconds = number & { readonly __brand: 's' };

// Conversion utilities
export const ms = (value: number): Milliseconds => value as Milliseconds;
export const sec = (value: number): Seconds => value as Seconds;
export const secToMs = (s: Seconds): Milliseconds => (s * 1000) as Milliseconds;
export const msToSec = (m: Milliseconds): Seconds => (m / 1000) as Seconds;

// Safety margin multiplier (child should be 80% of parent max)
const SAFETY_MARGIN = 0.8;

// Tier 1: External Request Timeouts (Gateway/Proxy layer)
export const EXTERNAL_TIMEOUTS = {
  // This is the absolute maximum for any user request
  PROXY_REQUEST_MS: ms(parseInt(getEnv('PROXY_TIMEOUT_MS') ?? '90000')),
  WEBSOCKET_CONNECT_MS: ms(30_000),
} as const;

// Tier 2: Internal Request Timeouts (must be < PROXY with margin)
export const REQUEST_TIMEOUTS = {
  // Request handler timeout (default: 80% of proxy timeout)
  DEFAULT_MS: ms(Math.floor(EXTERNAL_TIMEOUTS.PROXY_REQUEST_MS * SAFETY_MARGIN)),

  // Healthcheck and monitoring (very short)
  HEALTHCHECK_MS: ms(2_000),
} as const;

// Tier 3: Render Pipeline Timeouts (must be < REQUEST with margin)
const RENDER_BUDGET = Math.floor(REQUEST_TIMEOUTS.DEFAULT_MS * SAFETY_MARGIN);
export const RENDER_TIMEOUTS = {
  // Master render pipeline timeout
  PIPELINE_MS: ms(RENDER_BUDGET),

  // Semaphore acquisition (fail-fast)
  SEMAPHORE_ACQUIRE_MS: ms(5_000),

  // Individual stages (must sum to < PIPELINE)
  MODULE_LOAD_MS: ms(Math.floor(RENDER_BUDGET * 0.2)),  // 20%
  DATA_FETCH_MS: ms(Math.floor(RENDER_BUDGET * 0.3)),   // 30%
  SSR_RENDER_MS: ms(Math.floor(RENDER_BUDGET * 0.4)),   // 40%
  // 10% margin for overhead

  // Optional stages
  CSS_GENERATE_MS: ms(5_000),
} as const;

// Tier 4: I/O Operation Timeouts (granular operations)
export const IO_TIMEOUTS = {
  HTTP_FETCH_MS: ms(10_000),
  REDIS_OPERATION_MS: ms(5_000),
  FILE_READ_MS: ms(5_000),
  TRANSFORM_MS: ms(15_000),
} as const;

// Tier 5: Background/Async Timeouts
export const BACKGROUND_TIMEOUTS = {
  REVALIDATION_MS: ms(15_000),
  CACHE_REFRESH_MS: ms(30_000),
  HEARTBEAT_MS: ms(60_000),
} as const;

// Tier 6: User-Facing Timeouts (CLI, Auth)
export const USER_TIMEOUTS = {
  LOGIN_FLOW_MS: ms(120_000),
  CLI_SHUTDOWN_MS: ms(3_000),
  SANDBOX_EXECUTION_MS: ms(5_000),
} as const;

// Validation at module load time
function validateTimeoutHierarchy(): void {
  const errors: string[] = [];

  // Tier 2 must be less than Tier 1
  if (REQUEST_TIMEOUTS.DEFAULT_MS >= EXTERNAL_TIMEOUTS.PROXY_REQUEST_MS) {
    errors.push(`REQUEST_TIMEOUT (${REQUEST_TIMEOUTS.DEFAULT_MS}) must be < PROXY_TIMEOUT (${EXTERNAL_TIMEOUTS.PROXY_REQUEST_MS})`);
  }

  // Tier 3 must be less than Tier 2
  if (RENDER_TIMEOUTS.PIPELINE_MS >= REQUEST_TIMEOUTS.DEFAULT_MS) {
    errors.push(`RENDER_PIPELINE (${RENDER_TIMEOUTS.PIPELINE_MS}) must be < REQUEST_TIMEOUT (${REQUEST_TIMEOUTS.DEFAULT_MS})`);
  }

  // Stage sum must be less than pipeline
  const stageSum = RENDER_TIMEOUTS.MODULE_LOAD_MS +
                   RENDER_TIMEOUTS.DATA_FETCH_MS +
                   RENDER_TIMEOUTS.SSR_RENDER_MS;
  if (stageSum >= RENDER_TIMEOUTS.PIPELINE_MS) {
    errors.push(`Stage sum (${stageSum}) must be < PIPELINE (${RENDER_TIMEOUTS.PIPELINE_MS})`);
  }

  if (errors.length > 0) {
    throw new Error(`Timeout hierarchy violation:\n${errors.join('\n')}`);
  }
}

// Run validation on import (fails fast at startup)
validateTimeoutHierarchy();
```

### 2. Timeout Builder Pattern

```typescript
// For operations that need configurable timeouts with hierarchy

export class TimeoutBuilder {
  private parentTimeout: Milliseconds;

  constructor(parent: Milliseconds) {
    this.parentTimeout = parent;
  }

  /** Get a child timeout that's a percentage of parent */
  child(percentage: number): Milliseconds {
    if (percentage < 0 || percentage > 100) {
      throw new Error('Percentage must be 0-100');
    }
    return ms(Math.floor(this.parentTimeout * (percentage / 100)));
  }

  /** Get remaining time after elapsed */
  remaining(elapsed: number): Milliseconds {
    return ms(Math.max(0, this.parentTimeout - elapsed));
  }

  /** Check if we have at least `needed` ms remaining */
  hasTime(needed: number, elapsed: number): boolean {
    return this.remaining(elapsed) >= needed;
  }
}

// Usage:
const renderBudget = new TimeoutBuilder(REQUEST_TIMEOUTS.DEFAULT_MS);
const moduleLoadTimeout = renderBudget.child(20);  // 20% of request timeout
```

### 3. Timeout Context for Request Tracing

```typescript
// Pass timeout context through the request chain

export interface TimeoutContext {
  /** When the request started */
  startTime: number;
  /** Absolute deadline (startTime + timeout) */
  deadline: number;
  /** Original timeout value */
  timeout: Milliseconds;
}

export function createTimeoutContext(timeout: Milliseconds): TimeoutContext {
  const now = Date.now();
  return {
    startTime: now,
    deadline: now + timeout,
    timeout,
  };
}

export function getRemainingTime(ctx: TimeoutContext): Milliseconds {
  return ms(Math.max(0, ctx.deadline - Date.now()));
}

export function hasRemainingTime(ctx: TimeoutContext, needed: Milliseconds): boolean {
  return getRemainingTime(ctx) >= needed;
}

// Usage in handler:
async function handleRequest(req: Request): Promise<Response> {
  const ctx = createTimeoutContext(REQUEST_TIMEOUTS.DEFAULT_MS);

  // Pass to render pipeline
  const result = await renderPage(req, { timeoutCtx: ctx });

  // Render pipeline checks remaining time before each stage
  if (!hasRemainingTime(ctx, RENDER_TIMEOUTS.SSR_RENDER_MS)) {
    throw new Error('Insufficient time for SSR render');
  }
}
```

## Migration Path

### Phase 1: Centralize Constants (Week 1)
1. Create `src/utils/constants/timeouts.ts` with all values
2. Update all imports to use centralized constants
3. Add deprecation warnings on old constants

### Phase 2: Add Hierarchy Validation (Week 2)
1. Implement `validateTimeoutHierarchy()`
2. Add startup check
3. Fix any hierarchy violations

### Phase 3: Propagate Timeout Context (Week 3)
1. Add `TimeoutContext` to request handling
2. Update render pipeline to check remaining time
3. Add logging for timeout-related events

### Phase 4: Clean Up Hardcoded Values (Week 4)
1. Search for hardcoded timeout patterns
2. Replace with constants or computed values
3. Update tests to use test-specific constants

## Files Requiring Changes

High priority (production impact):
- `src/middleware/builtin/timeout.ts`
- `src/server/universal-handler/index.ts`
- `src/rendering/renderer.ts`
- `src/rendering/orchestrator/pipeline.ts`
- `proxy/main.ts`

Medium priority (affects specific features):
- `src/transforms/esm/http-bundler.ts`
- `src/transforms/esm/http-cache.ts`
- `src/modules/react-loader/ssr-module-loader/*`
- `src/data/static-data-fetcher.ts`
- `src/data/server-data-fetcher.ts`

Lower priority (dev/test):
- `src/cli/auth/callback-server.ts`
- `src/cli/commands/doctor/server-checks.ts`
- `tests/_helpers/constants.ts`
