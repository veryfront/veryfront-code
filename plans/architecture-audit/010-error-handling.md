# Chapter 10: Error Handling and Silent Failures

## Executive Summary

The veryfront-renderer codebase has **multiple parallel error systems** that have evolved organically, resulting in inconsistent error handling patterns. This creates debugging difficulties, lost error context, and numerous silent failures that can mask production issues.

**Key Findings:**
- 3+ distinct error systems coexist without clear guidelines
- 150+ locations with silent catch blocks (`catch {}` or `catch(() => {})`)
- Inconsistent timeout handling: some return `undefined`, others throw
- Error context frequently lost during propagation
- Custom error classes exist but are underutilized

---

## Sub-Analyses

| Document | Severity | Issue |
|----------|----------|-------|
| **[010.0 - Error Handling RFC](./010.0-error-handling-rfc.md)** | RFC | Unified error handling architecture proposal |
| **[010.1 - Global failedComponents](./010.1-failed-components-global-state.md)** | CRITICAL | Circuit breaker error state leaks between projects |
| **[010.2 - Global Error Collector](./010.2-global-error-collector.md)** | HIGH | MCP error collector shared across projects |
| **[010.3 - Dual VeryfrontError](./010.3-dual-veryfront-error-definitions.md)** | HIGH | Two incompatible types with same name |
| **[010.4 - withErrorContext](./010.4-witherrorcontext-silent-failures.md)** | HIGH | Silent failure pattern hides production issues |
| **[010.5 - wrapError Stack Loss](./010.5-wraperror-stack-trace-loss.md)** | MEDIUM | Original stack trace lost in Error.cause |
| **[010.6 - Inconsistent 500s](./010.6-inconsistent-500-responses.md)** | MEDIUM | Different error response formats across handlers |

---

## 1. Error Systems Inventory

The codebase contains **three parallel error systems**:

### 1.1 Typed Union System (`src/errors/veryfront-error.ts`)

A TypeScript discriminated union approach for error typing:

```typescript
// File: src/errors/veryfront-error.ts
export type VeryfrontError =
  | { type: "build"; message: string; context?: BuildContext }
  | { type: "api"; message: string; context?: APIContext }
  | { type: "render"; message: string; context?: RenderContext }
  | { type: "config"; message: string; context?: ConfigContext }
  | { type: "agent"; message: string; context?: AgentContext }
  | { type: "file"; message: string; context?: FileContext }
  | { type: "network"; message: string; context?: NetworkContext }
  | { type: "permission"; message: string; context?: FileContext }
  | { type: "not_supported"; message: string; feature?: string };

export function createError(error: VeryfrontError): VeryfrontError {
  return error;  // Just returns the error object - no Error instance
}
```

**Problem:** This returns plain objects, not `Error` instances, so stack traces are lost.

### 1.2 Class-Based System (`src/errors/types.ts` + domain files)

A traditional class hierarchy extending `Error`:

```typescript
// File: src/errors/types.ts
export class VeryfrontError extends Error {
  public code: ErrorCode;
  public context?: unknown;

  constructor(message: string, code: ErrorCode, context?: unknown) {
    super(message);
    this.name = "VeryfrontError";
    this.code = code;
    this.context = context;
  }
}

// File: src/errors/agent-errors.ts
export class AgentError extends VeryfrontError { ... }
export class AgentNotFoundError extends VeryfrontError { ... }
export class AgentTimeoutError extends VeryfrontError { ... }
export class AgentIntentError extends VeryfrontError { ... }
export class OrchestrationError extends VeryfrontError { ... }

// File: src/errors/build-errors.ts
export class BuildError extends VeryfrontError { ... }
export class CompilationError extends VeryfrontError { ... }

// File: src/errors/runtime-errors.ts
export class RuntimeError extends VeryfrontError { ... }
export class RenderError extends VeryfrontError { ... }

// File: src/errors/system-errors.ts
export class FileSystemError extends SystemError { ... }
export class ConfigError extends SystemError { ... }
export class NetworkError extends SystemError { ... }
export class PermissionError extends SystemError { ... }
export class NotSupportedError extends SystemError { ... }
```

**Problem:** Two VeryfrontError definitions coexist with the same name but different structures.

### 1.3 Error Catalog System (`src/errors/catalog/`)

User-friendly error messages with solutions:

```typescript
// File: src/errors/catalog/factory.ts
export function createErrorSolution(
  code: ErrorCodeType,
  config: Omit<ErrorSolution, "code" | "docs"> & { docs?: string },
): ErrorSolution {
  return {
    ...config,
    code,
    docs: config.docs ?? getErrorDocsUrl(code),
  };
}

// Example usage in src/errors/catalog/module-errors.ts
export const MODULE_ERROR_CATALOG: PartialErrorCatalog = {
  [ErrorCode.CACHE_PATH_MISMATCH]: createErrorSolution(ErrorCode.CACHE_PATH_MISMATCH, {
    title: "Cache path mismatch",
    message: "Cached code contains file paths from a different environment.",
    steps: [...],
    example: `...`,
  }),
};
```

**Problem:** This system provides guidance but doesn't integrate with thrown errors.

### 1.4 Context-Aware Error Handling (`src/errors/error-context.ts`)

A wrapper system for logging errors from silent operations:

```typescript
// File: src/errors/error-context.ts
export async function withErrorContext<T>(
  operation: () => Promise<T>,
  context: ErrorContext,
  options: ErrorHandlingOptions<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    logError(error, context, options.logLevel, options.includeStack);
    return options.fallback;  // Always returns fallback on error
  }
}
```

**Problem:** Silently swallows errors and returns fallbacks, hiding the root cause.

---

## 2. Silent Failure Locations

### 2.1 Promise Chain Silent Catches (6 locations)

```typescript
// File: src/rendering/utils/stream-utils.ts:89
reader.cancel("Stream read timeout").catch(() => {});

// File: src/html/hydration-script-builder/templates/router.ts:309, 319
fetchPageDataFresh(path, null).catch(() => {});
return fetchPageDataFresh(path, null).catch(() => {});

// File: src/html/hydration-script-builder/dev-error-logger.ts:19
fetch('/_veryfront/log', {...}).catch(() => {});

// File: src/server/handlers/request/ssr/ssr-handler.ts:309, 341
await response.body?.cancel().catch(() => {});
```

### 2.2 Empty Catch Blocks (150+ locations)

Categorized by intent:

#### Intentional File System Ignores (~40 locations)
```typescript
// File: src/rendering/layouts/layout-collector.ts:399-401
try {
  await adapter.fs.stat(candidatePath);
} catch {
  // File doesn't exist, continue checking other extensions
}

// File: src/platform/adapters/fs/veryfront/adapter.ts:736-738
try {
  this.watcher?.close();
} catch {
  // Ignore close errors
}
```

#### Module Resolution Fallbacks (~25 locations)
```typescript
// File: src/modules/server/module-server.ts:384-386, 401-403, 423-425, 440-442
try {
  // try to resolve module
} catch {
  // continue
}

// File: src/modules/import-map/loader.ts:78-80
try {
  const config = await loadConfig();
} catch {
  // Config not found or invalid, fall through to file-based discovery
}
```

#### Cache/Cleanup Best-Effort (~30 locations)
```typescript
// File: src/testing/isolation.ts:118-120
try {
  delete (globalThis as any)[key];
} catch {
  // Best-effort cleanup for globals that might be non-configurable.
}

// File: src/rendering/ssr/mdx-module-loader.ts:163-165
try {
  cleanupResources();
} catch {
  // Best-effort cleanup
}
```

#### Environment Detection (~15 locations)
```typescript
// File: src/platform/compat/process.ts
try {
  return Deno.env.get(key);
} catch {
  // Permission denied or not available
}

// File: src/utils/constants/cache.ts:17-20
try {
  return Deno.env.get(key);
} catch {
  // Gracefully handle missing --allow-env permission in Deno
  return undefined;
}
```

#### Observability/Logging (~10 locations)
```typescript
// File: src/observability/simple-metrics/otel-instruments.ts:16-18
try {
  logger.debug("...");
} catch {
  // Logger unavailable
}

// File: src/observability/metrics/config.ts:81-83
try {
  return getEnv(key);
} catch {
  // getEnv access may fail, silently continue
}
```

#### Error Handling Meta-Catch (~5 locations)
```typescript
// File: src/errors/error-handlers.ts:14-16
try {
  serverLogger.warn("[errors] Logging failed:", error);
} catch {
  // Silently ignore if even warning fails
}
```

---

## 3. Custom Error Classes Inventory

### 3.1 Framework Error Classes

| Class | File | ErrorCode | Purpose |
|-------|------|-----------|---------|
| `VeryfrontError` | `src/errors/types.ts` | Various | Base class for all framework errors |
| `AgentError` | `src/errors/agent-errors.ts` | `AGENT_ERROR` | Generic agent failures |
| `AgentNotFoundError` | `src/errors/agent-errors.ts` | `AGENT_NOT_FOUND` | Agent lookup failures |
| `AgentTimeoutError` | `src/errors/agent-errors.ts` | `AGENT_TIMEOUT` | Agent execution timeouts |
| `AgentIntentError` | `src/errors/agent-errors.ts` | `AGENT_INTENT_ERROR` | Intent parsing failures |
| `OrchestrationError` | `src/errors/agent-errors.ts` | `ORCHESTRATION_ERROR` | Workflow orchestration failures |
| `BuildError` | `src/errors/build-errors.ts` | `BUILD_ERROR` | Build process failures |
| `CompilationError` | `src/errors/build-errors.ts` | `COMPILATION_ERROR` | Code compilation failures |
| `RuntimeError` | `src/errors/runtime-errors.ts` | `RENDER_ERROR` | Runtime execution errors |
| `RenderError` | `src/errors/runtime-errors.ts` | `RENDER_ERROR` | SSR rendering errors |
| `FileSystemError` | `src/errors/system-errors.ts` | `FILE_NOT_FOUND` | File system operations |
| `ConfigError` | `src/errors/system-errors.ts` | `CONFIG_ERROR` | Configuration issues |
| `NetworkError` | `src/errors/system-errors.ts` | `NETWORK_ERROR` | Network failures |
| `PermissionError` | `src/errors/system-errors.ts` | `PERMISSION_ERROR` | Permission denied |
| `NotSupportedError` | `src/errors/system-errors.ts` | `NOT_SUPPORTED` | Unsupported operations |

### 3.2 Stream/Timeout Error Classes

| Class | File | Purpose |
|-------|------|---------|
| `TimeoutError` | `src/rendering/utils/stream-utils.ts` | Generic timeout |
| `StreamTimeoutError` | `src/rendering/utils/stream-utils.ts` | Stream read timeout with partial content |

### 3.3 Platform-Specific Errors

| Class | File | Purpose |
|-------|------|---------|
| `VeryfrontAPIError` | `src/platform/adapters/veryfront-api-client/types.ts` | API client errors |
| `SemaphoreTimeoutError` | `src/utils/semaphore.ts` | Semaphore acquisition timeout |

---

## 4. Error Propagation Issues

### 4.1 Context Loss in Fallback Returns

```typescript
// File: src/errors/error-context.ts:62-73
export async function withErrorContext<T>(
  operation: () => Promise<T>,
  context: ErrorContext,
  options: ErrorHandlingOptions<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    logError(error, context, options.logLevel, options.includeStack);
    return options.fallback;  // Original error lost, caller sees only fallback
  }
}
```

**Impact:** Callers cannot distinguish between "no data" and "error fetching data".

### 4.2 Error Wrapping Loses Stack

```typescript
// File: src/errors/error-handlers.ts:32-52
export function wrapError(
  error: unknown,
  message: string,
  context?: unknown,
): VeryfrontError {
  const originalError = error instanceof Error ? error : new Error(String(error));
  const errorMessage = `${message}: ${originalError.message}`;

  const wrappedContext = {
    originalError: {
      name: originalError.name,
      message: originalError.message,
      stack: originalError.stack,  // Stack stored in context, not in Error.stack
    },
    ...(context as Record<string, unknown> | undefined),
  };

  return new VeryfrontError(errorMessage, errorCode, wrappedContext);
  // New Error created, original stack lost from Error.stack property
}
```

### 4.3 Type Guard Confusion

Two `VeryfrontError` types exist:

```typescript
// Type 1: Plain object union (src/errors/veryfront-error.ts)
type VeryfrontError = { type: "build"; message: string; ... } | ...

// Type 2: Error class (src/errors/types.ts)
class VeryfrontError extends Error { code: ErrorCode; context?: unknown; }
```

This causes confusion when checking error types:

```typescript
// Sometimes used as:
if (error instanceof VeryfrontError) { ... }

// Sometimes used as:
if (isBuildError(error)) { ... }  // Type guard for union type
```

### 4.4 Conditional Error Logging

```typescript
// File: src/data/static-data-fetcher.ts:208-211
private logError(message: string, error: unknown, context?: Record<string, unknown>): void {
  if (!this.adapter?.env.get("VERYFRONT_DEBUG")) return;  // Only logs in debug mode!
  serverLogger.error(message, context ?? {}, error);
}
```

**Impact:** Production errors may never be logged.

---

## 5. Timeout Handling Patterns

### 5.1 Soft Timeout (Returns undefined)

```typescript
// File: src/rendering/utils/stream-utils.ts:11-33
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T | undefined> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<undefined>((resolve) => {
    timeoutId = setTimeout(() => {
      logger.warn("TIMEOUT_SOFT operation timed out (returning undefined)", {
        label,
        timeoutMs,
      });
      resolve(undefined);  // Returns undefined, not throwing
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
```

**Risk:** Caller must check for `undefined`, but type signature doesn't enforce it.

### 5.2 Hard Timeout (Throws)

```typescript
// File: src/rendering/utils/stream-utils.ts:35-54
export async function withTimeoutThrow<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      logger.error("TIMEOUT_HARD operation timed out (throwing)", { label, timeoutMs });
      reject(new TimeoutError(label, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
```

### 5.3 Timeout Constants (Inconsistent)

| Location | Constant | Value | Purpose |
|----------|----------|-------|---------|
| `src/rendering/orchestrator/pipeline.ts:48` | `CSS_SSR_TIMEOUT_MS` | 5000 | CSS generation |
| `src/rendering/orchestrator/pipeline.ts:85` | `MODULE_LOAD_TIMEOUT_MS` | 10000 | Module loading |
| `src/rendering/orchestrator/pipeline.ts:88` | `DATA_FETCH_TIMEOUT_MS` | 15000 | Data fetching |
| `src/rendering/orchestrator/pipeline.ts:91` | `SSR_RENDER_TIMEOUT_MS` | 20000 | SSR rendering |
| `src/rendering/renderer.ts:91` | `RENDER_PIPELINE_TIMEOUT_MS` | 60000 | Overall render |
| `src/rendering/renderer.ts:104` | `RENDER_ACQUIRE_TIMEOUT_MS` | 5000 | Semaphore acquire |
| `src/data/static-data-fetcher.ts` | `REVALIDATION_TIMEOUT_MS` | imported | Background revalidation |

---

## 6. Risk Assessment

### 6.1 Critical Risks (Production Impact)

| Risk | Location | Impact |
|------|----------|--------|
| Silent module resolution failures | `src/modules/server/module-server.ts` | Pages fail to render without clear cause |
| Lost error context in SSR | `src/server/handlers/request/ssr/ssr-handler.ts` | 500 errors with no actionable details |
| Conditional logging in production | `src/data/static-data-fetcher.ts` | Data fetch errors invisible |
| Soft timeout returning undefined | `src/rendering/utils/stream-utils.ts` | Undefined propagates, causes later null errors |

### 6.2 Medium Risks (Debugging Difficulty)

| Risk | Location | Impact |
|------|----------|--------|
| Two VeryfrontError definitions | `src/errors/types.ts` vs `src/errors/veryfront-error.ts` | Type confusion |
| Error catalog not linked to exceptions | `src/errors/catalog/` | User-friendly messages not shown |
| Stack traces stored in context | `src/errors/error-handlers.ts` | Standard tooling doesn't see stacks |

### 6.3 Low Risks (Code Quality)

| Risk | Location | Impact |
|------|----------|--------|
| 150+ empty catch blocks | Codebase-wide | Technical debt |
| Inconsistent error codes | `src/errors/types.ts` | `RuntimeError` uses `RENDER_ERROR` |

---

## 7. Success Criteria

A successful error handling refactor should achieve:

### 7.1 Unified Error System
- [ ] Single `VeryfrontError` class with proper inheritance
- [ ] All errors extend base class with `code`, `context`, and proper stack
- [ ] Error catalog integrated into error classes

### 7.2 Explicit Failure Modes
- [ ] All silent catches documented with `// SILENT: reason`
- [ ] `withErrorContext` renamed to `withErrorFallback` with explicit fallback handling
- [ ] `withTimeout` replaced by `withTimeoutThrow` everywhere (remove soft timeout)

### 7.3 Error Propagation
- [ ] No error context lost during wrapping
- [ ] Original stacks preserved through Error.cause
- [ ] Production logging unconditional

### 7.4 Metrics and Monitoring
- [ ] Error types tracked in metrics
- [ ] Silent failures logged at debug level minimum
- [ ] Timeout events tracked separately

---

## 8. Recommended Solution

### 8.1 Unified Error Class Hierarchy

```typescript
// src/errors/base.ts
export abstract class VeryfrontError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly context: ErrorContext;

  constructor(message: string, options?: { cause?: Error }) {
    super(message, options);  // ES2022 cause support
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }

  toJSON(): SerializedError {
    return {
      code: this.code,
      message: this.message,
      context: this.context,
      stack: this.stack,
      cause: this.cause instanceof Error ? this.cause.message : undefined,
    };
  }
}
```

### 8.2 Strict Timeout Handling

```typescript
// Remove withTimeout (soft), keep only withTimeoutThrow
// All timeouts should throw, callers must handle

// Instead of:
const result = await withTimeout(fetch(), 5000, "fetch");
if (result === undefined) { /* handle timeout */ }

// Use:
try {
  const result = await withTimeoutThrow(fetch(), 5000, "fetch");
} catch (e) {
  if (e instanceof TimeoutError) { /* handle timeout */ }
  throw e;
}
```

### 8.3 Silent Catch Annotation Pattern

```typescript
// All silent catches should use this pattern:
try {
  await operation();
} catch (error) {
  // SILENT: File may not exist during initial scan (non-error condition)
  logger.debug("Optional file not found", { path, error: getErrorMessage(error) });
}

// Or use explicit helper:
import { ignoreError } from "#veryfront/errors";

await ignoreError(
  () => operation(),
  "ENOENT",  // Expected error codes to ignore
  { context: "file-scan", path }
);
```

### 8.4 Error Catalog Integration

```typescript
// Errors should reference catalog:
export class ModuleNotFoundError extends VeryfrontError {
  readonly code = ErrorCode.MODULE_NOT_FOUND;

  constructor(modulePath: string, cause?: Error) {
    const solution = getErrorSolution(ErrorCode.MODULE_NOT_FOUND);
    super(`${solution.title}: ${modulePath}`, { cause });
    this.context = { modulePath, solution };
  }
}
```

---

## 9. Implementation Priority

### Phase 1: Stop the Bleeding (1-2 days)
1. Add `// SILENT:` comments to all empty catch blocks
2. Enable unconditional production logging
3. Convert critical `withTimeout` to `withTimeoutThrow`

### Phase 2: Unify Error System (3-5 days)
1. Consolidate two `VeryfrontError` definitions
2. Update all custom error classes to use `Error.cause`
3. Integrate error catalog into thrown errors

### Phase 3: Systematic Cleanup (1-2 weeks)
1. Review each silent catch for necessity
2. Add metrics for error types
3. Create error handling documentation

---

## 10. Files Requiring Changes

### Critical Files
- `/Users/mattboon/Sites/veryfront-renderer/src/errors/types.ts` - Unify VeryfrontError
- `/Users/mattboon/Sites/veryfront-renderer/src/errors/veryfront-error.ts` - Deprecate plain object system
- `/Users/mattboon/Sites/veryfront-renderer/src/errors/error-handlers.ts` - Preserve stacks in wrapError
- `/Users/mattboon/Sites/veryfront-renderer/src/rendering/utils/stream-utils.ts` - Remove soft timeout
- `/Users/mattboon/Sites/veryfront-renderer/src/data/static-data-fetcher.ts` - Enable production logging

### High-Impact Files
- `/Users/mattboon/Sites/veryfront-renderer/src/modules/server/module-server.ts` - 6 silent catches
- `/Users/mattboon/Sites/veryfront-renderer/src/server/handlers/request/ssr/ssr-handler.ts` - SSR error handling
- `/Users/mattboon/Sites/veryfront-renderer/src/rendering/orchestrator/pipeline.ts` - Pipeline timeout handling
- `/Users/mattboon/Sites/veryfront-renderer/src/errors/error-context.ts` - Rename and document fallback behavior
