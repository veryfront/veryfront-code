# Adapter Fallback Wrapper Pattern

## Overview

The adapter fallback wrapper provides a centralized, type-safe way to handle fallback logic when adapter operations fail. This eliminates duplicate try-catch blocks and provides consistent error handling across the codebase.

## Problem

Before this wrapper, the codebase had 30+ duplicate try-catch blocks like this:

```typescript
import { withFallback } from "@veryfront/platform/adapters";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts"; // Assuming fs compat is available

const fs = createFileSystem();

const content = await withFallback(
  () => adapter.fs.readFile(path),
  () => fs.readTextFile(path),
  { operationName: "readFile" },
);
```

### 2. `withFallbackSync` - Synchronous Operations

```typescript
import { withFallbackSync } from "@veryfront/platform/adapters";
import { getEnv } from "@veryfront/platform/compat/process.ts"; // Assuming process compat is available

const value = withFallbackSync(
  () => adapter.env.get("KEY"),
  () => getEnv("KEY"),
  { operationName: "env.get" },
);
```

### 3. `createAdapterFallback` - Reusable Async Wrapper

```typescript
import { createAdapterFallback } from "@veryfront/platform/adapters";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts"; // Assuming fs compat is available

const fs = createFileSystem();

const readFile = createAdapterFallback(
  () => this.adapter.fs.readFile(this.configPath),
  () => fs.readTextFile(this.configPath),
  "readFile",
);

// Can be called multiple times
const content1 = await readFile.execute();
const content2 = await readFile = await readFile.execute();
```

**Issues with this approach:**

- Code duplication (500+ lines)
- No error logging or telemetry
- Difficult to test
- Inconsistent error handling
- Leaky abstraction (Deno references everywhere)

## Solution

The fallback wrapper provides four main functions:

### 1. `withFallback` - Async Operations

```typescript
import { withFallback } from "@veryfront/platform/adapters";

const content = await withFallback(
  () => adapter.fs.readFile(path),
  () => Deno.readTextFile(path),
  { operationName: "readFile" },
);
```

### 2. `withFallbackSync` - Synchronous Operations

```typescript
import { withFallbackSync } from "@veryfront/platform/adapters";

const value = withFallbackSync(
  () => adapter.env.get("KEY"),
  () => Deno.env.get("KEY"),
  { operationName: "env.get" },
);
```

### 3. `createAdapterFallback` - Reusable Async Wrapper

```typescript
import { createAdapterFallback } from "@veryfront/platform/adapters";

const readFile = createAdapterFallback(
  () => adapter.fs.readFile(path),
  () => Deno.readTextFile(path),
  "readFile",
);

// Can be called multiple times
const content1 = await readFile.execute();
const content2 = await readFile.execute();
```

### 4. `createAdapterFallbackSync` - Reusable Sync Wrapper

```typescript
import { createAdapterFallbackSync } from "@veryfront/platform/adapters";

const getEnv = createAdapterFallbackSync(
  () => adapter.env.get(key),
  () => Deno.env.get(key),
  "env.get",
);

const value = getEnv.executeSync();
```

## Features

### Automatic Error Logging

The wrapper automatically logs errors with context:

```typescript
await withFallback(
  () => adapter.operation(),
  () => someOtherOperation(), // Placeholder for a cross-platform operation
  {
    operationName: "operation",
    logError: true, // default
  },
);
```

Logs:

- `[debug]` when primary fails and fallback is attempted
- `[debug]` when fallback succeeds
- `[error]` when both primary and fallback fail

### Disable Logging

For operations where logging is not needed:

```typescript
await withFallback(
  () => adapter.operation(),
  () => someOtherOperation(), // Placeholder for a cross-platform operation
  {
    operationName: "operation",
    logError: false,
  },
);
```

### Error Context Preservation

When both operations fail, errors are preserved:

```typescript
try {
  await withFallback(
    () => adapter.operation(),
    () => someOtherOperation(), // Placeholder for a cross-platform operation
    { operationName: "operation" },
  );
} catch (error) {
  if (error instanceof FallbackExecutionError) {
    console.log(error.primaryError); // Original adapter error
    console.log(error.fallbackError); // Fallback error
  }
}
```

### Custom Error Handling

Control whether to throw `FallbackExecutionError` or just the fallback error:

```typescript
await withFallback(
  () => adapter.operation(),
  () => someOtherOperation(), // Placeholder for a cross-platform operation
  {
    operationName: "operation",
    rethrowOnFallbackFailure: false, // throws fallback error directly
  },
);
```

## Usage Examples

```typescript
import { withFallback } from "@veryfront/platform/adapters";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";

async function readConfig(adapter: RuntimeAdapter) {
  const fs = createFileSystem();
  return await withFallback(
    () => adapter.fs.readFile("config.json"),
    () => fs.readTextFile("config.json"),
    { operationName: "readFile:config" },
  );
}
```

### Environment Variables

```typescript
import { withFallbackSync } from "@veryfront/platform/adapters";
import { getEnv } from "@veryfront/platform/compat/process.ts";

function getPort(adapter: RuntimeAdapter): number {
  const portStr = withFallbackSync(
    () => adapter.env.get("PORT"),
    () => getEnv("PORT"),
    { operationName: "env.get:PORT" },
  );
  return Number(portStr ?? 3000);
}
```

### Network Requests

```typescript
import { withFallback } from "@veryfront/platform/adapters";

async function fetchData(adapter: RuntimeAdapter, url: string) {
  return await withFallback(
    () => adapter.fetch(url),
    () => fetch(url),
    { operationName: "fetch" },
  );
}
```

### Creating Reusable Wrappers

```typescript
import { createAdapterFallback } from "@veryfront/platform/adapters";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";

class ConfigLoader {
  private fs = createFileSystem();
  private readFile = createAdapterFallback(
    () => this.adapter.fs.readFile(this.configPath),
    () => this.fs.readTextFile(this.configPath),
    "readFile:config",
  );

  async load() {
    const content = await this.readFile.execute();
    return JSON.parse(content);
  }
}
```

## Testing

The wrapper is designed for easy testing via dependency injection:

```typescript
import { withFallback } from "@veryfront/platform/adapters";

// In tests, pass mock functions
const mockAdapter = () => Promise.resolve("mock-result");
const mockFallback = () => Promise.resolve("fallback-result");

const result = await withFallback(
  mockAdapter,
  mockFallback,
  { operationName: "test", logError: false },
);

assertEquals(result, "mock-result");
```

## Migration Guide

### Before (Duplicate Pattern)

```typescript
async function readUserConfig(adapter: RuntimeAdapter, path: string) {
  let content: string;
  try {
    content = await adapter.fs.readFile(path);
  } catch {
    content = await Deno.readTextFile(path);
  }
  return JSON.parse(content);
}
```

### After (Using Wrapper)

```typescript
import { withFallback } from "@veryfront/platform/adapters";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";

async function readUserConfig(adapter: RuntimeAdapter, path: string) {
  const fs = createFileSystem();
  const content = await withFallback(
    () => adapter.fs.readFile(path),
    () => fs.readTextFile(path),
    { operationName: "readFile:userConfig" },
  );
  return JSON.parse(content);
}
```

## Benefits

1. **DRY Principle**: Eliminates 500+ lines of duplicate code
2. **Testability**: Easy to test via dependency injection
3. **Observability**: Automatic error logging with context
4. **Type Safety**: Full TypeScript support with generics
5. **Flexibility**: Options for logging, error handling, sync/async
6. **Consistency**: Standardized error handling across the codebase
7. **Maintainability**: Single source of truth for fallback logic
8. **Error Context**: Preserves both primary and fallback errors for debugging

## Best Practices

1. **Always provide descriptive operation names** for logging:
   ```typescript
   withFallback(..., { operationName: "readFile:config" }) // Good
   withFallback(..., { operationName: "operation" })       // Bad
   ```

2. **Use reusable wrappers for frequently called operations**:
   ```typescript
   const readFile = createAdapterFallback(...);
   // Call multiple times without recreating
   ```

3. **Disable logging for high-frequency operations**:
   ```typescript
   withFallback(..., { operationName: "cache.get", logError: false })
   ```

4. **Handle FallbackExecutionError for critical operations**:
   ```typescript
   try {
     await withFallback(...);
   } catch (error) {
     if (error instanceof FallbackExecutionError) {
       // Handle both errors appropriately
     }
   }
   ```

## Architecture Decision

This wrapper follows the Adapter pattern and provides:

- **Abstraction**: Hides fallback complexity
- **Encapsulation**: Centralizes error handling logic
- **Separation of Concerns**: Business logic separate from fallback logic
- **Open/Closed Principle**: Easy to extend without modifying existing code

## Performance Considerations

The wrapper adds minimal overhead:

- No performance impact on successful primary operations
- Only allocates additional objects when fallback is needed
- Logging can be disabled for high-frequency operations
- Reusable wrappers avoid function recreation overhead
