# Core Module

## Purpose

The core module is Veryfront's foundation layer, providing essential utilities, configuration management, error handling, and shared types used across all other modules. It acts as the central nervous system of the framework.

## Scope

### What this module does:

- Configuration loading and validation
- Error handling and error catalog
- Logging infrastructure
- Common type definitions
- Utility functions (caching, hashing, path handling)
- Runtime environment detection
- Feature flags management

### What this module does NOT do:

- Request/response handling (see `server/`)
- Build operations (see `build/`)
- React-specific logic (see `react/`)

## Architecture

```
core/
├── config/              # Configuration system
│   ├── define-config.ts # Config definition
│   ├── loader.ts        # Config file loading
│   ├── schema.ts        # Zod validation schemas
│   └── types.ts         # Config type definitions
├── errors/              # Error handling [has README]
│   ├── catalog/         # Error catalog & factory
│   ├── user-friendly/   # User-facing error messages
│   └── veryfront-error.ts # Base error class
├── types/               # Shared type definitions
│   └── index.ts         # Type exports
└── utils/               # Utility functions
    ├── cache/           # Caching utilities
    ├── constants/       # Framework constants
    ├── logger/          # Logging system
    ├── hash-utils.ts    # Hashing functions
    ├── path-utils.ts    # Path manipulation
    ├── runtime-guards.ts # Runtime detection
    └── version.ts       # Version info
```

## Key Exports

### Configuration

- `defineConfig(config)` - Type-safe config definition
- `loadConfig(projectDir)` - Load and validate config
- `VeryfrontConfig` - Config type definition

### Error Handling

- `VeryfrontError` - Base error class
- `createError(code, message)` - Error factory
- Error catalog with user-friendly messages

### Utilities

- `logger` - Structured logging
- `LRUCache` - Memory cache with TTL
- `hashContent(data)` - Content hashing
- `normalizePath(path)` - Path normalization
- `isRuntimeDeno()` / `isRuntimeNode()` - Runtime detection

### Types

- `PageContext` - Page rendering context
- `MDXFrontmatter` - MDX metadata
- Common entity types

## Dependencies

### Internal

- None (foundation module, no internal deps)

### External

- `zod` - Schema validation
- `@std/path` - Path utilities (Deno)

## Usage Examples

### Configuration

```typescript
import { defineConfig } from "@veryfront/config";

export default defineConfig({
  title: "My App",
  description: "My awesome Veryfront app",
  build: {
    outDir: ".veryfront/build",
    minify: true,
  },
  server: {
    port: 3000,
    hostname: "localhost",
  },
});
```

### Error Handling

```typescript
import { createError } from "@veryfront/errors";

// Create typed error
const error = createError("BUILD_FAILED", "Asset optimization failed", {
  file: "image.png",
  reason: "Unsupported format",
});

// Check error type
if (error.code === "BUILD_FAILED") {
  console.error("Build error:", error.message);
  console.error("Details:", error.metadata);
}
```

### Logging

```typescript
import { logger } from "@veryfront/utils";

// Structured logging
logger.info("Server started", { port: 3000, mode: "production" });
logger.warn("Using fallback config", { reason: "File not found" });
logger.error("Request failed", { error, url: req.url });

// Time operations
logger.time("build");
await buildProduction();
logger.timeEnd("build");
```

### Caching

```typescript
import { LRUCache } from "@veryfront/utils";

// Create cache with max size and TTL
const cache = new LRUCache<string, CompiledPage>({
  max: 100,
  ttl: 60_000, // 60 seconds
});

// Use cache
const cached = cache.get(key);
if (cached) {
  return cached;
}

const result = await expensiveOperation();
cache.set(key, result);
return result;
```

### Runtime Detection

```typescript
import { isRuntimeDeno, isRuntimeNode } from "@veryfront/utils";

if (isRuntimeDeno()) {
  // Use Deno APIs
  const fs = await getAdapter().then((adapter) => adapter.fs);
  const file = await fs.readFile(path);
} else if (isRuntimeNode()) {
  // Use Node APIs
  const file = await fs.readFile(path, "utf-8");
}
```

## Configuration Schema

### veryfront.config.ts

```typescript
export default {
  // Basic info
  title: string
  description?: string

  // Build configuration
  build: {
    outDir: string
    minify: boolean
    sourcemap: boolean
    assets: {
      images: { formats, quality, sizes }
      css: { minify, autoprefixer }
    }
  }

  // Server configuration
  server: {
    port: number
    hostname: string
    cors: { origin, methods, credentials }
  }

  // Feature flags
  experimental: {
    rsc: boolean
    islands: boolean
  }
}
```

## Performance

### Cache Performance

- LRU cache with O(1) get/set operations
- Automatic eviction with TTL
- Memory-efficient doubly-linked list

### Config Loading

- Config cached after first load
- Validation runs once at startup
- ~5ms typical load time

## Testing

```bash
# Run all core tests
deno task test src/core/

# Test specific subsystems
deno task test src/core/config/
deno task test src/core/errors/
deno task test src/core/utils/
```

## Related Modules

- [`errors/`](./errors/README.md) - Error handling subsystem
- [`config/`](./config/) - Configuration loading
- All modules depend on `core/`

## Troubleshooting

### Config Validation Errors

```typescript
// Enable verbose validation
import { loadConfig } from "@veryfront/config";

try {
  const config = await loadConfig(projectDir);
} catch (error) {
  if (error.code === "CONFIG_INVALID") {
    console.error("Validation errors:", error.metadata.issues);
  }
}
```

### Cache Memory Issues

```typescript
// Reduce cache size or disable TTL cleanup
const cache = new LRUCache({
  max: 50, // Reduce from 100
  ttl: 0, // Disable TTL to reduce cleanup overhead
});
```

## Maintainer Notes

**Team:** Core Infrastructure Team
**Stability:** Stable (v0.1.0+)
**Breaking Changes:** Must be coordinated with all modules

This is the foundation module - changes here affect the entire framework.
