# Core Constants Module

This directory contains centralized constants used throughout the Veryfront framework. By extracting magic numbers and strings into well-named constants, we improve code maintainability, consistency, and clarity.

## Purpose

- **Maintainability**: Change values in one place instead of hunting through the codebase
- **Consistency**: Ensure the same values are used everywhere they're needed
- **Clarity**: Self-documenting code through descriptive constant names
- **Type Safety**: Constants are properly typed and can be used with type checking

## Module Organization

### Core Constants (this directory)

#### `priorities.ts`

Handler priority constants defining execution order in the middleware pipeline.

```typescript
import { PRIORITY_FALLBACK, PRIORITY_HIGH } from "@veryfront/core/constants";

// Handler runs early
priority: PRIORITY_HIGH;

// Handler runs last (404 handler)
priority: PRIORITY_FALLBACK;
```

**Priority Levels:**

- `PRIORITY_CRITICAL` (0): Security, authentication
- `PRIORITY_VERY_HIGH` (50): CORS, security headers
- `PRIORITY_HIGH` (100-300): Health checks, monitoring
- `PRIORITY_MEDIUM` (400-700): File serving, API routes
- `PRIORITY_LOW` (1000): SSR catch-all
- `PRIORITY_FALLBACK` (10000): 404 handler

#### `retry.ts`

Retry and error handling configuration.

```typescript
import { API_RETRY_INITIAL_DELAY_MS, DEFAULT_RETRY_MAX_ATTEMPTS } from "@veryfront/core/constants";

await retryWithBackoff(operation, {
  maxRetries: DEFAULT_RETRY_MAX_ATTEMPTS,
  initialDelay: API_RETRY_INITIAL_DELAY_MS,
});
```

**Key Constants:**

- `DEFAULT_RETRY_MAX_ATTEMPTS` (3)
- `DEFAULT_RETRY_INITIAL_DELAY_MS` (100ms)
- `DEFAULT_RETRY_MAX_DELAY_MS` (5000ms)
- API, FS, and WebSocket specific retry configs

#### `buffers.ts`

Buffer sizes and memory limits.

```typescript
import { BUFFER_SIZE_8_KB, DEFAULT_MAX_BODY_SIZE_BYTES } from "@veryfront/core/constants";

const buffer = new Uint8Array(BUFFER_SIZE_8_KB);
```

**Key Constants:**

- Standard buffer sizes: 256B, 512B, 1KB, 2KB, 4KB, 8KB, 16KB, 32KB, 64KB
- `RSC_FILE_READ_BUFFER_SIZE_BYTES` (2KB)
- `DEFAULT_MAX_BODY_SIZE_BYTES` (1MB)
- `DEFAULT_MAX_HEADER_SIZE_BYTES` (8KB)
- `HMR_MAX_MESSAGE_SIZE_BYTES` (1MB)

#### `limits.ts`

Display limits and truncation values.

```typescript
import { LOG_PREVIEW_MAX_LENGTH_CHARS, MAX_STACK_TRACE_LINES } from "@veryfront/core/constants";

const preview = body.slice(0, LOG_PREVIEW_MAX_LENGTH_CHARS);
```

**Key Constants:**

- `LOG_PREVIEW_MAX_LENGTH_CHARS` (500)
- `CODE_PREVIEW_MAX_LENGTH_CHARS` (200)
- `MAX_STACK_TRACE_LINES` (100)
- Cache size constants: SMALL (50), MEDIUM (200), LARGE (500), XLARGE (1000)
- `MAX_PORT_NUMBER` (65535)
- `MAX_PATH_LENGTH_CHARS` (4096)

#### `metrics.ts`

Metrics collection and histogram boundaries.

```typescript
import {
  DEFAULT_METRICS_COLLECTION_INTERVAL_MS,
  SSR_RENDER_TIME_BOUNDARIES_MS,
} from "@veryfront/core/constants";

// Histogram with predefined buckets
histogram.record(duration, SSR_RENDER_TIME_BOUNDARIES_MS);
```

**Key Constants:**

- `SSR_RENDER_TIME_BOUNDARIES_MS`: [5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000]
- `DEFAULT_METRICS_COLLECTION_INTERVAL_MS` (60000ms = 1 minute)
- Rate limiting defaults

#### `crypto.ts`

Cryptographic algorithm identifiers and hash constants.

```typescript
import { HASH_ALGORITHM_SHA256, SHA256_HEX_LENGTH } from "@veryfront/core/constants";

const hash = await crypto.subtle.digest(HASH_ALGORITHM_SHA256, data);
```

**Key Constants:**

- `HASH_ALGORITHM_SHA256` ("SHA-256")
- `SHA256_HEX_LENGTH` (64 characters)
- Hash seed values for non-cryptographic hashing
- `CSP_NONCE_LENGTH_BYTES` (16)

### Utility Constants (`../utils/constants/`)

These are re-exported from the core constants module for convenience.

#### `http.ts`

HTTP status codes, content types, and timeouts.

```typescript
import { HTTP_CONTENT_TYPES, HTTP_NOT_FOUND, HTTP_OK } from "@veryfront/core/constants";

return new Response(body, {
  status: HTTP_OK,
  headers: { "Content-Type": HTTP_CONTENT_TYPES.JSON },
});
```

**Key Constants:**

- Status codes: `HTTP_OK` (200), `HTTP_NOT_FOUND` (404), `HTTP_SERVER_ERROR` (500), etc.
- Status ranges: `HTTP_STATUS_SUCCESS_MIN` (200), `HTTP_STATUS_SERVER_ERROR_MIN` (500)
- Content types: `HTTP_CONTENT_TYPES.JSON`, `.HTML`, `.JS`, `.CSS`, `.TEXT`
- Image types: `HTTP_CONTENT_TYPE_IMAGE_PNG`, `.JPEG`, `.WEBP`, `.AVIF`, `.SVG`
- Timeouts: `HTTP_MODULE_FETCH_TIMEOUT_MS` (2500ms)
- Localhost addresses

#### `cache.ts`

Cache TTLs, cleanup intervals, and time units.

```typescript
import { CACHE_CLEANUP_INTERVAL_MS, ONE_DAY_MS } from "@veryfront/core/constants";

const ttl = 7 * ONE_DAY_MS; // 7 days
```

**Key Constants:**

- Time units: `MS_PER_SECOND`, `SECONDS_PER_MINUTE`, `MINUTES_PER_HOUR`, `HOURS_PER_DAY`
- Component cache: `COMPONENT_LOADER_MAX_ENTRIES` (100), `COMPONENT_LOADER_TTL_MS` (10min)
- MDX cache: `MDX_RENDERER_MAX_ENTRIES` (200), `MDX_RENDERER_TTL_MS` (10min)
- HTTP cache: `HTTP_CACHE_SHORT_MAX_AGE_SEC` (60s), `MEDIUM` (1hr), `LONG` (1yr)
- `CACHE_CLEANUP_INTERVAL_MS` (60000ms = 1 minute)
- `LRU_DEFAULT_MAX_ENTRIES` (1000)

#### `network.ts`

Network ports, image sizes, and byte conversions.

```typescript
import { BYTES_PER_KB, DEFAULT_DEV_SERVER_PORT } from "@veryfront/core/constants";

const sizeKB = totalBytes / BYTES_PER_KB;
```

**Key Constants:**

- Ports: `DEFAULT_DEV_SERVER_PORT` (3000), `DEFAULT_REDIS_PORT` (6379), `DEFAULT_API_SERVER_PORT` (8080)
- Byte units: `BYTES_PER_KB` (1024), `BYTES_PER_MB` (1024²)
- Image sizes: `DEFAULT_IMAGE_THUMBNAIL_SIZE` (256), `SMALL` (512), `LARGE` (2048)
- Responsive widths: `RESPONSIVE_IMAGE_WIDTH_XS` (320), `SM` (640), `MD` (1024), `LG` (1920)
- Port validation: `MIN_PORT` (1), `MAX_PORT` (65535)

#### `hmr.ts`

Hot Module Replacement constants.

```typescript
import { HMR_CLIENT_RELOAD_DELAY_MS, HMR_MESSAGE_TYPES } from "@veryfront/core/constants";

if (message.type === HMR_MESSAGE_TYPES.UPDATE) {
  // Handle update
}
```

**Key Constants:**

- `HMR_MESSAGE_TYPES`: CONNECTED, UPDATE, RELOAD, PING, PONG
- `HMR_CLIENT_RELOAD_DELAY_MS` (3000ms)
- `HMR_MAX_MESSAGES_PER_MINUTE` (100)
- WebSocket close codes

#### `html.ts`

HTML/CSS layout constants.

```typescript
import { Z_INDEX_ERROR_OVERLAY, BREAKPOINT_MD } from '@veryfront/core/constants';

style={{ zIndex: Z_INDEX_ERROR_OVERLAY }}
```

**Key Constants:**

- Z-indexes: `Z_INDEX_DEV_INDICATOR` (9998), `Z_INDEX_ERROR_OVERLAY` (9999)
- Breakpoints: `BREAKPOINT_SM` (640), `MD` (768), `LG` (1024), `XL` (1280)
- `PROSE_MAX_WIDTH` ("65ch")

#### `security.ts`

Security validation constants.

```typescript
import { DIRECTORY_TRAVERSAL_PATTERN, MAX_PATH_TRAVERSAL_DEPTH } from "@veryfront/core/constants";

if (DIRECTORY_TRAVERSAL_PATTERN.test(path)) {
  throw new Error("Path traversal detected");
}
```

**Key Constants:**

- `MAX_PATH_TRAVERSAL_DEPTH` (10)
- `FORBIDDEN_PATH_PATTERNS`: Null bytes, etc.
- `DIRECTORY_TRAVERSAL_PATTERN`: Regex for `../`
- `ABSOLUTE_PATH_PATTERN`: Regex for absolute paths
- `MAX_PATH_LENGTH` (4096)

#### `server.ts`

Server endpoint paths.

```typescript
import { DEV_SERVER_ENDPOINTS } from "@veryfront/core/constants";

const hmrPath = DEV_SERVER_ENDPOINTS.HMR_RUNTIME;
```

#### `build.ts`

Build system constants.

```typescript
import { DEFAULT_BUILD_CONCURRENCY, IMAGE_OPTIMIZATION } from "@veryfront/core/constants";

const quality = IMAGE_OPTIMIZATION.DEFAULT_QUALITY;
```

#### `cdn.ts`

CDN URLs and version constants.

```typescript
import { getReactCDNUrl, REACT_DEFAULT_VERSION } from "@veryfront/core/constants";

const reactUrl = getReactCDNUrl(REACT_DEFAULT_VERSION);
```

#### `hash.ts`

Hash seed values for non-cryptographic hashing.

```typescript
import { HASH_SEED_DJB2 } from "@veryfront/core/constants";

let hash = HASH_SEED_DJB2;
```

## Usage Guidelines

### DO:

Import constants instead of using magic numbers
Use descriptive constant names that explain the purpose
Add JSDoc comments for non-obvious values
Group related constants together
Use ALL_CAPS naming for constants
Include units in names (e.g., `_MS`, `_BYTES`, `_KB`)

### DON'T:

Hardcode magic numbers directly in code
Create duplicate constants across files
Use unclear names like `MAX_VALUE` or `LIMIT`
Mix different units (always specify: MS, BYTES, KB, etc.)
Create constants for values used only once in a single location

## Examples

### Before (Magic Numbers):

```typescript
// Bad: Magic numbers with unclear meaning
const timeout = setTimeout(reload, 3000);
const buffer = new Uint8Array(8192);
if (response.status >= 500) {
  // error
}
```

### After (Named Constants):

```typescript
// Good: Clear, self-documenting code
import {
  BUFFER_SIZE_8_KB,
  HMR_CLIENT_RELOAD_DELAY_MS,
  HTTP_STATUS_SERVER_ERROR_MIN,
} from "@veryfront/core/constants";

const timeout = setTimeout(reload, HMR_CLIENT_RELOAD_DELAY_MS);
const buffer = new Uint8Array(BUFFER_SIZE_8_KB);
if (response.status >= HTTP_STATUS_SERVER_ERROR_MIN) {
  // error
}
```

## Adding New Constants

When you identify a magic number that should be a constant:

1. **Determine the category**: Where does this constant belong?
   - HTTP-related? → `http.ts`
   - Cache/TTL? → `cache.ts`
   - Buffer/memory? → `buffers.ts`
   - Display limits? → `limits.ts`
   - New category? → Create a new file

2. **Choose a descriptive name**:
   - Use ALL_CAPS
   - Include units: `_MS`, `_BYTES`, `_KB`, `_CHARS`
   - Be specific: `RSC_FILE_READ_BUFFER_SIZE_BYTES` not `BUFFER_SIZE`

3. **Add JSDoc comment** if the purpose isn't immediately obvious:
   ```typescript
   /**
    * Maximum delay between retry attempts
    * Prevents exponential backoff from waiting too long
    */
   export const DEFAULT_RETRY_MAX_DELAY_MS = 5000;
   ```

4. **Export from index.ts** if it's in the core constants directory

5. **Update this README** with the new constant

## Migration Strategy

The constants module is designed to be used incrementally. Future refactoring tasks will:

1. Replace hardcoded values with these constants throughout the codebase
2. Ensure consistency by using the same constant everywhere
3. Remove duplicate definitions

This is tracked in the Wave 2 refactoring tasks (FIXER-2-3, FIXER-2-4).

## Related Documentation

- See `VERYFRONT_ARCHITECTURE_OVERVIEW.md` for overall architecture
- See Wave 1 and Wave 2 refactoring plans for migration strategy
