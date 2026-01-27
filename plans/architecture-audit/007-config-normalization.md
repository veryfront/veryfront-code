# Chapter 7: Config Format Normalization

## The Problem

The veryfront-renderer codebase has config options that accept the **same conceptual value** in **different formats** depending on where they are used. This creates:

1. **Cognitive overhead**: Developers must remember which format to use where
2. **Inconsistent validation**: Some formats are validated, others slip through
3. **Scattered normalization**: Format conversion happens ad-hoc throughout the codebase
4. **Documentation confusion**: Which format is canonical?

The core issue: **there is no single source of truth for config format**.

---

## Inventory of Format Inconsistencies

### 1. Router Configuration

**Two different representations of the same concept:**

| Location | Option | Values | Purpose |
|----------|--------|--------|---------|
| `config.router` | `router` | `"app"` \| `"pages"` | Runtime router selection |
| `config.generate.preferredRouter` | `preferredRouter` | `"app-router"` \| `"pages-router"` | CLI generate preference |

**Type definitions:**

```typescript
// src/config/types.ts:21
router?: "app" | "pages";

// src/config/types.ts:238
generate?: {
  /** Preferred router for generated pages */
  preferredRouter?: "app-router" | "pages-router";
};
```

**Current handling (scattered normalization):**

```typescript
// src/cli/commands/generate.ts:47-48
const pref = cfg?.generate?.preferredRouter ?? cfg?.router;
if (pref === "app-router" || pref === "pages-router") return pref;

// src/server/dev-server/route-discovery.ts:81-86
const preferredRouter = this.config?.router;
if (preferredRouter === "app") candidates.push({ type: "app", dir: "app" });
else if (preferredRouter === "pages") candidates.push({ type: "pages", dir: "pages" });
```

**Problem**: The generate command must handle BOTH formats because users might set either. The route discovery only handles the short format.

---

### 2. CORS Configuration

**Multiple valid input formats:**

| Format | Example | Use Case |
|--------|---------|----------|
| Boolean | `cors: true` | Enable default CORS |
| Boolean | `cors: false` | Disable CORS |
| Object (simple) | `cors: { origin: "https://example.com" }` | Simple origin restriction |
| Object (full) | `cors: { origin: [...], credentials: true, methods: [...] }` | Full CORS control |

**Type definitions:**

```typescript
// src/config/types.ts:87
cors?: boolean | { origin?: string };

// src/security/http/cors/types.ts:3-10
export interface CORSConfig {
  origin?: string | string[] | OriginValidator;
  credentials?: boolean;
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  maxAge?: number;
}

// src/types/server.ts:32-41 (SecurityConfig)
cors?:
  | boolean
  | {
    origin?: string | string[] | ((origin: string) => boolean);
    credentials?: boolean;
    methods?: string[];
    allowedHeaders?: string[];
    exposedHeaders?: string[];
    maxAge?: number;
  };
```

**Discrepancy**: The config schema (`types.ts:87`) only allows `origin?: string`, but the runtime types allow arrays and functions.

**Current validation:**

```typescript
// src/config/schema.ts:5
const corsSchema = z.union([z.boolean(), z.object({ origin: z.string().optional() }).strict()]);

// src/config/loader.ts:84-99
function validateCorsConfig(userConfig: unknown): void {
  const origin = (cors as Record<string, unknown>).origin;
  if (origin !== undefined && typeof origin !== "string") {
    throw new ConfigValidationError(
      "security.cors.origin must be a string. Expected boolean or { origin?: string }",
    );
  }
}
```

**Current normalization:**

```typescript
// src/security/http/cors/validators.ts:9-37
function validateEarly(
  requestOrigin: string | null,
  config?: boolean | CORSConfig,
): CORSValidationResult | null {
  if (!config) return NO_CORS_RESULT;
  if (config === true) {
    return { allowedOrigin: requestOrigin ?? "*", allowCredentials: false };
  }
  // ... more handling
}

// src/security/http/config.ts:46
security.cors ??= true;  // Default to enabled
```

**Problem**: Normalization happens at validation time AND at runtime, with different rules.

---

### 3. Layout Configuration

**Union type accepting string or false:**

```typescript
// src/config/types.ts:22-25
/** Path to the layout component (e.g., 'components/layout.tsx'), or false to disable */
layout?: string | false;
/** Path to the app wrapper component (e.g., 'components/app.tsx'), or false to disable */
app?: string | false;

// src/config/schema.ts:45-47
layout: z.union([z.string(), z.literal(false)]).optional(),
app: z.union([z.string(), z.literal(false)]).optional(),
```

**Usage patterns:**

```typescript
// Various layout handling code checks both forms
if (config.layout === false) {
  // Explicitly disabled
} else if (config.layout) {
  // Use custom path
} else {
  // Use default discovery
}
```

**Problem**: Three states (`undefined`, `false`, `string`) but no normalization to a consistent internal representation.

---

### 4. Cache Configuration

**Multiple layers with `type` and `enabled` separately:**

```typescript
// src/config/types.ts:37-54
cache?: {
  dir?: string;
  bundleManifest?: {
    type?: "redis" | "kv" | "memory";
    redisUrl?: string;
    keyPrefix?: string;
    ttl?: number;
    enabled?: boolean;  // <-- enabled is separate from type
  };
  render?: {
    type?: "memory" | "filesystem" | "kv" | "redis";
    ttl?: number;
    maxEntries?: number;
    kvPath?: string;
    redisUrl?: string;
    redisKeyPrefix?: string;
  };
};
```

**Inconsistency**: `bundleManifest` has both `type` AND `enabled`, but `render` only has `type` (implicit enabled).

**Current handling:**

```typescript
// src/utils/bundle-manifest-init.ts:17-26
const manifestConfig = config.cache?.bundleManifest;
const enabled = manifestConfig?.enabled ?? mode === "production";  // enabled has default

if (!enabled) {
  setBundleManifestStore(new InMemoryBundleManifestStore());
  return;
}

const storeType = manifestConfig?.type ?? adapter?.env.get("VERYFRONT_BUNDLE_MANIFEST_TYPE") ??
  "memory";  // type also has default
```

**Problem**: The relationship between `type` and `enabled` is unclear. Can you set `type: "redis"` but `enabled: false`?

---

### 5. Client Module Resolution

**Versions can be "auto" or an object:**

```typescript
// src/config/types.ts:229-234
cdn?: {
  provider?: "esm.sh" | "unpkg" | "jsdelivr";
  /** 'auto' detects from package.json, or pin specific versions */
  versions?: "auto" | { react?: string; veryfront?: string };
};

// src/config/schema.ts:286-294
versions: z
  .union([
    z.literal("auto"),
    z.object({
      react: z.string().optional(),
      veryfront: z.string().optional(),
    }),
  ])
  .optional(),
```

**Problem**: Code must handle both `"auto"` string and object format throughout.

---

### 6. Observability Configuration

**Enabled flags at multiple levels:**

```typescript
// src/config/types.ts:134-149
observability?: {
  tracing?: {
    enabled?: boolean;  // Feature toggle
    exporter?: "jaeger" | "zipkin" | "otlp" | "console";  // Type selection
    endpoint?: string;
    serviceName?: string;
    sampleRate?: number;
  };
  metrics?: {
    enabled?: boolean;  // Feature toggle
    exporter?: "prometheus" | "otlp" | "console";  // Type selection
    endpoint?: string;
    prefix?: string;
    collectInterval?: number;
  };
};
```

**Problem**: `enabled: false` with `exporter: "otlp"` - what does this mean? Configured but disabled?

---

### 7. AI/MCP Configuration

**Similar pattern with enabled + specific options:**

```typescript
// src/config/types.ts:201-224
ai?: {
  enabled?: boolean;
  providers?: Record<string, { ... }>;
  tools?: {
    discovery?: {
      enabled?: boolean;
      paths?: string[];
    };
  };
  agents?: {
    discovery?: {
      enabled?: boolean;
      paths?: string[];
    };
  };
  mcp?: {
    enabled?: boolean;
    port?: number;
    expose?: string[];
  };
};
```

**Problem**: Nested `enabled` flags at multiple levels create complex boolean logic.

---

## Code Examples: Where Each Format Is Used

### Router Format Mapping

```
User Config                    Internal Usage
-----------                    --------------
router: "app"              --> route-discovery.ts uses "app"
router: "pages"            --> route-discovery.ts uses "pages"
generate.preferredRouter:  --> generate.ts must map:
  "app-router"                   "app-router" -> "app-router" (kept)
  "pages-router"                 "pages-router" -> "pages-router" (kept)

BUT the generate command tries to use BOTH:
  cfg?.generate?.preferredRouter ?? cfg?.router

This creates mismatch: "app" != "app-router"
```

### CORS Format Evolution

```
User Input           Schema Validation      Runtime Type         Actual Behavior
----------           -----------------      ------------         ---------------
cors: true           boolean                boolean | CORSConfig  Allow all origins
cors: false          boolean                boolean | CORSConfig  No CORS headers
cors: {origin: "*"}  object w/ string       CORSConfig            Allow all origins
cors: {origin: [...]} FAILS validation      CORSConfig            Would work at runtime
```

---

## The Normalization Pattern: "Accept Liberal, Emit Strict"

### Principle

1. **Accept**: Multiple input formats at config boundary (user-facing)
2. **Normalize**: Convert to single canonical format immediately after validation
3. **Emit**: Internal code only ever sees the normalized format

### Visual Flow

```
                    BOUNDARY
                       |
User Config -----> [Normalizer] -----> Internal Config
                       |
  "app-router"    normalize()         { router: "app" }
  "app"                               { router: "app" }

  cors: true      normalize()         { cors: { enabled: true, origin: "*" } }
  cors: {...}                         { cors: { enabled: true, origin: "..." } }

  layout: false   normalize()         { layout: { enabled: false, path: null } }
  layout: "path"                      { layout: { enabled: true, path: "path" } }
```

---

## Success Criteria

### 1. Single Internal Format

Every config option has ONE canonical internal representation:

```typescript
// Internal types (never shown to users)
interface NormalizedConfig {
  router: "app" | "pages";  // No "app-router" format

  cors: {
    enabled: boolean;
    origin: string | string[] | OriginValidator;
    credentials: boolean;
    methods: string[];
    allowedHeaders: string[];
    exposedHeaders: string[];
    maxAge: number;
  };

  layout: {
    enabled: boolean;
    path: string | null;
  };

  cache: {
    bundleManifest: {
      enabled: boolean;
      type: "redis" | "kv" | "memory";
      // ... other fields
    };
  };
}
```

### 2. Normalization at Config Load

All format conversion happens in ONE place:

```typescript
// src/config/normalize.ts
export function normalizeConfig(input: VeryfrontConfigInput): NormalizedConfig {
  return {
    router: normalizeRouter(input.router, input.generate?.preferredRouter),
    cors: normalizeCors(input.security?.cors),
    layout: normalizeLayout(input.layout),
    cache: normalizeCache(input.cache),
    // ...
  };
}
```

### 3. Type Safety

```typescript
// Consumer code gets typed normalized config
function handleRequest(config: NormalizedConfig) {
  // No need to check multiple formats
  if (config.cors.enabled) {
    // config.cors is ALWAYS the full object type
  }
}
```

---

## Recommended Solution: Config Normalization Layer

### File Structure

```
src/config/
  types.ts              # User-facing input types (liberal)
  schema.ts             # Zod validation
  normalize.ts          # NEW: Format normalization
  normalized-types.ts   # NEW: Internal strict types
  loader.ts             # Uses normalizer after validation
  index.ts              # Exports
```

### Implementation

#### 1. Normalized Types (src/config/normalized-types.ts)

```typescript
/**
 * Internal normalized config types.
 * All code outside src/config/ should use these types.
 */

export type RouterType = "app" | "pages";

export interface NormalizedCorsConfig {
  enabled: boolean;
  origin: string | string[] | ((origin: string) => boolean | string);
  credentials: boolean;
  methods: string[];
  allowedHeaders: string[];
  exposedHeaders: string[];
  maxAge: number;
}

export interface NormalizedLayoutConfig {
  enabled: boolean;
  path: string | null;
}

export interface NormalizedCacheConfig {
  dir: string;
  bundleManifest: {
    enabled: boolean;
    type: "redis" | "kv" | "memory";
    redisUrl: string | null;
    keyPrefix: string;
    ttl: number;
  };
  render: {
    enabled: boolean;
    type: "memory" | "filesystem" | "kv" | "redis";
    ttl: number;
    maxEntries: number;
  };
}

export interface NormalizedConfig {
  projectSlug: string | null;
  title: string;
  description: string;
  router: RouterType;
  layout: NormalizedLayoutConfig;
  app: NormalizedLayoutConfig;
  cors: NormalizedCorsConfig;
  cache: NormalizedCacheConfig;
  // ... all other normalized fields
}
```

#### 2. Normalizer Functions (src/config/normalize.ts)

```typescript
import type { VeryfrontConfig } from "./types.ts";
import type { NormalizedConfig, RouterType, NormalizedCorsConfig } from "./normalized-types.ts";

/**
 * Normalize router format.
 * Accepts: "app", "pages", "app-router", "pages-router"
 * Emits: "app" | "pages"
 */
function normalizeRouter(
  router?: "app" | "pages",
  preferredRouter?: "app-router" | "pages-router"
): RouterType {
  // preferredRouter takes precedence (more specific setting)
  if (preferredRouter === "app-router") return "app";
  if (preferredRouter === "pages-router") return "pages";
  // Fall back to router setting
  return router ?? "pages";  // Default to pages
}

/**
 * Normalize CORS configuration.
 * Accepts: boolean | { origin?: string }
 * Emits: Full CORSConfig object
 */
function normalizeCors(
  cors?: boolean | { origin?: string }
): NormalizedCorsConfig {
  const defaults: NormalizedCorsConfig = {
    enabled: true,
    origin: "*",
    credentials: false,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: [],
    maxAge: 86400,
  };

  if (cors === undefined || cors === true) {
    return defaults;
  }

  if (cors === false) {
    return { ...defaults, enabled: false };
  }

  return {
    ...defaults,
    enabled: true,
    origin: cors.origin ?? "*",
  };
}

/**
 * Normalize layout configuration.
 * Accepts: string | false | undefined
 * Emits: { enabled: boolean, path: string | null }
 */
function normalizeLayout(
  layout?: string | false
): NormalizedLayoutConfig {
  if (layout === false) {
    return { enabled: false, path: null };
  }
  if (typeof layout === "string") {
    return { enabled: true, path: layout };
  }
  // undefined = use default discovery
  return { enabled: true, path: null };
}

/**
 * Main normalization entry point.
 * Called once after validation, before caching.
 */
export function normalizeConfig(input: VeryfrontConfig): NormalizedConfig {
  return {
    projectSlug: input.projectSlug ?? null,
    title: input.title ?? "Veryfront App",
    description: input.description ?? "Built with Veryfront",
    router: normalizeRouter(input.router, input.generate?.preferredRouter),
    layout: normalizeLayout(input.layout),
    app: normalizeLayout(input.app),
    cors: normalizeCors(input.security?.cors),
    cache: normalizeCache(input.cache),
    // ... normalize all other fields
  };
}
```

#### 3. Integration with Loader (src/config/loader.ts)

```typescript
import { normalizeConfig } from "./normalize.ts";
import type { NormalizedConfig } from "./normalized-types.ts";

// Change cache type
const configCacheByProject = new Map<string, {
  revision: number;
  config: NormalizedConfig  // Now stores normalized
}>();

function validateAndCacheConfig(
  userConfig: unknown,
  cacheKey: string
): NormalizedConfig {
  // 1. Validate shape
  validateConfigShape(userConfig);

  // 2. Merge with defaults (still using input types)
  const merged = mergeConfigs(userConfig as Partial<VeryfrontConfig>);

  // 3. NEW: Normalize to internal format
  const normalized = normalizeConfig(merged);

  // 4. Cache normalized config
  configCacheByProject.set(cacheKey, { revision: cacheRevision, config: normalized });

  return normalized;
}

// Update return type
export function getConfig(
  projectDir: string,
  adapter: RuntimeAdapter,
  options?: GetConfigOptions,
): Promise<NormalizedConfig> {  // Returns normalized type
  // ...
}
```

---

## Migration Path

### Phase 1: Add Normalization Layer (Non-Breaking)

1. Create `normalized-types.ts` with strict internal types
2. Create `normalize.ts` with conversion functions
3. Update `loader.ts` to normalize after validation
4. Export both types (input for config files, normalized for internal use)

### Phase 2: Update Consumers (Gradual)

1. Update type imports in consumer code to use `NormalizedConfig`
2. Remove ad-hoc normalization code (e.g., in generate.ts)
3. Simplify conditional logic that handled multiple formats

### Phase 3: Documentation

1. Document the two type systems (input vs normalized)
2. Update config documentation to show all accepted formats
3. Add deprecation warnings for confusing formats (e.g., `"app-router"` -> prefer `router: "app"`)

---

## Summary

| Problem | Solution |
|---------|----------|
| Router has two formats | Normalize at load: `"app-router"` -> `"app"` |
| CORS has boolean + object | Normalize to full object with `enabled` flag |
| Layout has string + false | Normalize to `{ enabled, path }` object |
| Cache has type + enabled | Normalize to consistent structure |
| Scattered normalization | Single `normalize.ts` module |
| Multiple type definitions | Input types (liberal) + Normalized types (strict) |

**The key insight**: Accept flexibility at the boundary (user config files), but enforce consistency internally. This is the same pattern used by successful config systems like ESLint, Webpack, and Vite.
