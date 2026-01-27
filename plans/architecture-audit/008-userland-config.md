# Chapter 8: Userland Configuration That Affects Code Paths

This document provides a comprehensive reference of all user-configurable options in the veryfront-renderer codebase that change how code executes. Understanding these configuration points is critical for debugging issues and predicting framework behavior.

---

## Architecture Issues Identified

| Issue | Severity | Document |
|-------|----------|----------|
| Global config cache shared across projects | HIGH | [008.1](./008.1-global-config-cache-pollution.md) |
| Unsafe config code execution via import() | CRITICAL | [008.2](./008.2-unsafe-config-execution.md) |
| Temp file race conditions during config load | MEDIUM | [008.3](./008.3-temp-file-race-condition.md) |
| Incomplete HMR cache invalidation | HIGH | [008.4](./008.4-hmr-cache-invalidation-incomplete.md) |
| Config schema validation gaps | MEDIUM | [008.5](./008.5-config-schema-validation-gaps.md) |

**RFC:** [008.0 - Request-Scoped Configuration](./008.0-userland-config-rfc.md)

---

## Table of Contents

1. [Configuration Sources Overview](#configuration-sources-overview)
2. [veryfront.config.ts Options](#veryfrontconfigts-options)
3. [Environment Variables](#environment-variables)
4. [Convention-Based File Detection](#convention-based-file-detection)
5. [Directory Structure Expectations](#directory-structure-expectations)
6. [Configuration Interaction Matrix](#configuration-interaction-matrix)

---

## Configuration Sources Overview

Veryfront-renderer loads configuration from multiple sources with the following precedence (highest to lowest):

| Priority | Source | Location | Affects |
|----------|--------|----------|---------|
| 1 | Runtime headers | `x-token`, `x-project-slug` | Per-request context |
| 2 | Environment variables | `process.env` / `Deno.env` | Server behavior |
| 3 | veryfront.config.ts | Project root | Build & runtime behavior |
| 4 | package.json fields | Project root | Version detection |
| 5 | Convention-based files | `app/`, `pages/`, `components/` | Auto-discovery |

---

## veryfront.config.ts Options

**Type Definition**: `/Users/mattboon/Sites/veryfront-renderer/src/config/types.ts`

### router: "app" | "pages"

**Type**: `"app" | "pages" | undefined`
**Default**: Auto-detected from directory structure

**Code Path Impact**: Determines which routing system processes requests.

**File Locations**:
- `/Users/mattboon/Sites/veryfront-renderer/src/rendering/router-detection.ts` - Detection logic
- `/Users/mattboon/Sites/veryfront-renderer/src/rendering/page-resolution/page-resolver.ts` - Page resolution

**Conditional Logic**:
```typescript
// src/rendering/router-detection.ts:48-55
export async function detectAppRouter(
  projectDir: string,
  config: VeryfrontConfig,
  adapter: RuntimeAdapter,
): Promise<boolean> {
  if (config?.router === "app") return true;
  if (config?.router === "pages") return false;
  // ... auto-detection follows
}
```

**Detection Algorithm**:
1. If `config.router === "app"` -> Use App Router
2. If `config.router === "pages"` -> Use Pages Router
3. Check if `app/` directory exists with route files -> Use App Router
4. Check if `pages/` directory exists with route files -> Use Pages Router
5. If `pages/` exists but not `app/` -> Use Pages Router
6. Default -> Use App Router

**Example Scenarios**:
| Config | Directory Structure | Result |
|--------|---------------------|--------|
| `router: "app"` | Any | App Router |
| `router: "pages"` | Any | Pages Router |
| undefined | `app/page.tsx` exists | App Router |
| undefined | `pages/index.tsx` only | Pages Router |
| undefined | Both exist | App Router (has priority) |

---

### layout: string | false

**Type**: `string | false | undefined`
**Default**: Auto-discovered from `components/layout.{tsx,jsx,ts,js,mdx,md}`

**Code Path Impact**: Controls which layout component wraps page content.

**File Locations**:
- `/Users/mattboon/Sites/veryfront-renderer/src/rendering/layouts/layout-collector.ts` - Collection logic
- `/Users/mattboon/Sites/veryfront-renderer/src/rendering/layouts/utils/discovery.ts` - Discovery

**Conditional Logic**:
```typescript
// src/rendering/layouts/layout-collector.ts:195-205
let layoutName: string | null = null;

if (layoutValue === false || layoutValue === "false") {
  layoutName = null;
} else if (typeof layoutValue === "string" && layoutValue.length > 0) {
  layoutName = layoutValue;
} else if (this.config?.layout === false) {
  layoutName = null;
} else if (typeof this.config?.layout === "string" && this.config.layout.length > 0) {
  layoutName = this.config.layout;
}
```

**Priority Order**:
1. Frontmatter `layout: false` -> No layout
2. Frontmatter `layout: "path/to/layout"` -> Use specified
3. Config `layout: false` -> No layout
4. Config `layout: "path/to/layout"` -> Use specified
5. Auto-discover `components/layout.{ext}` -> Use first found

**Example Scenarios**:
```typescript
// Disable layouts entirely
export default { layout: false };

// Custom layout path
export default { layout: "components/custom-layout.tsx" };

// Use default discovery (components/layout.tsx)
export default {};
```

---

### app: string | false

**Type**: `string | false | undefined`
**Default**: Auto-discovered from `components/app.{tsx,jsx,ts,js,mdx,md}`

**Code Path Impact**: Wraps the entire application for global providers/context.

**File Locations**:
- `/Users/mattboon/Sites/veryfront-renderer/src/rendering/layouts/utils/app-resolver.ts`

**Conditional Logic**:
```typescript
// src/rendering/layouts/utils/app-resolver.ts:25-53
const configApp = config?.app;

if (configApp === false) {
  return null;  // Disabled
}

if (configApp) {
  // Use specified path
  const appPath = configApp.startsWith("/") ? configApp : join(projectDir, configApp);
  if (await adapter.fs.exists(appPath)) return appPath;
  throw new Error(`App component not found: "${configApp}"`);
}

// Auto-discover components/app.{ext}
for (const ext of VALID_EXTENSIONS) {
  const appPath = join(projectDir, `components/app.${ext}`);
  if (await adapter.fs.exists(appPath)) return appPath;
}
```

---

### directories.*

**Type**: `{ app?: string; pages?: string; components?: string[]; ai?: string }`
**Default**: `{ app: "app", pages: "pages", components: ["components"], ai: "ai" }`

**Code Path Impact**: Changes where the framework looks for routes and components.

**File Locations**:
- `/Users/mattboon/Sites/veryfront-renderer/src/rendering/page-resolution/page-resolver.ts`
- `/Users/mattboon/Sites/veryfront-renderer/src/rendering/router-detection.ts`
- `/Users/mattboon/Sites/veryfront-renderer/src/rendering/orchestrator/lifecycle.ts`

**Usage**:
```typescript
// src/rendering/page-resolution/page-resolver.ts:49
const appDirName = this.config.directories?.app ?? "app";

// src/rendering/page-resolution/page-resolver.ts:91
const pagesDirName = this.config.directories?.pages ?? "pages";

// src/rendering/orchestrator/lifecycle.ts:197
const componentDirs = config.directories?.components ?? ["components"];
```

---

### fs.type: "local" | "veryfront-api" | "memory" | "github"

**Type**: `"local" | "veryfront-api" | "memory" | "github"`
**Default**: `"local"`

**Code Path Impact**: Determines how files are read - critically affects production vs development behavior.

**File Locations**:
- `/Users/mattboon/Sites/veryfront-renderer/src/platform/adapters/fs/factory.ts`

**Conditional Logic**:
```typescript
// src/platform/adapters/fs/factory.ts:25-100
export function createFSAdapter(config: FSAdapterConfig): Promise<FSAdapter> {
  const type = config.type ?? "local";

  if (type === "local") {
    throw toError(createError({
      type: "config",
      message: `FSAdapter type "local" should not use this factory.`
    }));
  }

  if (type === "veryfront-api") {
    if (config.veryfront?.proxyMode) {
      const { MultiProjectFSAdapter } = await import("./veryfront/multi-project-adapter.ts");
      return new MultiProjectFSAdapter(configWithCallbacks);
    }
    const { VeryfrontFSAdapter } = await import("./veryfront/index.ts");
    return new VeryfrontFSAdapter(configWithCallbacks);
  }

  if (type === "github") {
    const { GitHubFSAdapter } = await import("./github/index.ts");
    return new GitHubFSAdapter(config);
  }
}
```

**Adapter Behaviors**:
| Type | Source | Use Case |
|------|--------|----------|
| `local` | Local filesystem | Development |
| `veryfront-api` | Veryfront API | Production |
| `veryfront-api` + `proxyMode` | Multi-tenant API | Multi-project hosting |
| `github` | GitHub API | GitHub-backed projects |
| `memory` | In-memory | Testing |

---

### fs.veryfront.*

**Sub-options for `veryfront-api` filesystem adapter**:

```typescript
veryfront?: {
  apiBaseUrl: string;          // API endpoint
  apiToken?: string;           // Auth token (optional in proxy mode)
  projectSlug?: string;        // Project identifier
  proxyMode?: boolean;         // Multi-tenant mode
  productionMode?: boolean;    // Use releases vs draft
  cache?: {
    enabled?: boolean;         // Enable caching
    ttl?: number;              // Cache TTL in ms
    maxSize?: number;          // Max cache entries
  };
  retry?: {
    maxRetries?: number;       // Retry count
    initialDelay?: number;     // Initial backoff
    maxDelay?: number;         // Max backoff
  };
};
```

**Code Path Impact**: `proxyMode` triggers completely different adapter instantiation:
```typescript
// src/platform/adapters/fs/factory.ts:64-74
if (config.veryfront?.proxyMode) {
  const { MultiProjectFSAdapter } = await import("./veryfront/multi-project-adapter.ts");
  const adapter = new MultiProjectFSAdapter(configWithCallbacks);
  await adapter.initialize?.();
  return adapter;
}

const { VeryfrontFSAdapter } = await import("./veryfront/index.ts");
```

---

### cache.*

**Type**: Cache configuration for rendering and bundle manifests

```typescript
cache?: {
  dir?: string;                    // Base cache directory (default: .veryfront-cache)
  bundleManifest?: {
    type?: "redis" | "kv" | "memory";
    redisUrl?: string;
    keyPrefix?: string;
    ttl?: number;
    enabled?: boolean;
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

**File Locations**:
- `/Users/mattboon/Sites/veryfront-renderer/src/rendering/orchestrator/lifecycle.ts`

**Cache Store Selection**:
```typescript
// src/rendering/orchestrator/lifecycle.ts:95-121
const renderCacheConfig = config.cache?.render ?? {};

let cacheStore: CacheStore;
switch (renderCacheConfig.type) {
  case "filesystem":
    cacheStore = new FilesystemCacheStore({
      baseDir: join(projectDir, cacheBaseDir, "render"),
    });
    break;
  case "kv":
    cacheStore = new KVCacheStore({ path: renderCacheConfig.kvPath });
    break;
  case "redis":
    cacheStore = new RedisCacheStore({
      url: renderCacheConfig.redisUrl,
      keyPrefix: renderCacheConfig.redisKeyPrefix,
      enableFallback: false,
    });
    break;
  case "memory":
  default:
    cacheStore = new MemoryCacheStore({
      maxEntries: renderCacheConfig.maxEntries ?? (debugMode ? 50 : 500),
      ttlMs: renderCacheConfig.ttl,
    });
    break;
}
```

---

### experimental.*

**Type**: Feature flags for experimental functionality

```typescript
experimental?: {
  esmLayouts?: boolean;      // ESM-based layout loading
  precompileMDX?: boolean;   // Pre-compile MDX at build time
  rsc?: boolean;             // React Server Components
};
```

**File Locations**:
- `/Users/mattboon/Sites/veryfront-renderer/src/utils/feature-flags.ts`
- `/Users/mattboon/Sites/veryfront-renderer/src/config/runtime-config.ts`

**RSC Detection**:
```typescript
// src/utils/feature-flags.ts:4-9
export function isRSCEnabled(
  config?: { experimental?: { rsc?: boolean } },
  env?: RuntimeEnv,
): boolean {
  return config?.experimental?.rsc ?? isRscExperimentalEnabled(env);
}
```

---

### ai.*

**Type**: AI feature configuration

```typescript
ai?: {
  enabled?: boolean;
  providers?: Record<string, {
    apiKey?: string;
    baseURL?: string;
    defaultModel?: string;
    organization?: string;
  }>;
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

**File Locations**:
- `/Users/mattboon/Sites/veryfront-renderer/src/cli/commands/doctor/ai-checks.ts`

**AI Enabled Check**:
```typescript
// src/cli/commands/doctor/ai-checks.ts:24
if (!config.ai?.enabled) {
  return [{ status: "pass", name: "AI Features", message: "Not enabled" }];
}
```

---

### tailwind.*

**Type**: Tailwind CSS configuration

```typescript
tailwind?: {
  stylesheet?: string;           // Default: "globals.css"
  plugins?: Array<"forms" | "typography" | "aspect-ratio" | "container-queries">;
  theme?: {
    extend?: {
      colors?: Record<string, string | Record<string, string>>;
      fontFamily?: Record<string, string[]>;
      // ... other theme extensions
    };
  };
  customCSS?: string;           // Custom CSS content
};
```

**File Locations**:
- `/Users/mattboon/Sites/veryfront-renderer/src/rendering/orchestrator/html.ts`
- `/Users/mattboon/Sites/veryfront-renderer/src/html/styles-builder/tailwind-compiler.ts`

**Stylesheet Resolution**:
```typescript
// src/rendering/orchestrator/html.ts:260
const stylesheetPath = this.config.config?.tailwind?.stylesheet || "globals.css";
```

---

### security.*

**Type**: Security configuration

```typescript
security?: {
  auth?: {
    basic?: { username: string; password: string; realm?: string; };
    bearer?: { token: string; };
  };
  csp?: Partial<Record<string, string[]>>;
  remoteHosts?: string[];
  cors?: boolean | { origin?: string };
  coop?: "same-origin" | "same-origin-allow-popups" | "unsafe-none";
  corp?: "same-origin" | "same-site" | "cross-origin";
  coep?: "require-corp" | "unsafe-none";
  allowedImportDirs?: string[];
};
```

---

### client.*

**Type**: Client-side module resolution

```typescript
client?: {
  moduleResolution?: "cdn" | "self-hosted" | "bundled";
  cdn?: {
    provider?: "esm.sh" | "unpkg" | "jsdelivr";
    versions?: "auto" | { react?: string; veryfront?: string };
  };
};
```

---

### react.*

**Type**: React version configuration

```typescript
react?: {
  version?: string;  // e.g., "18.3.1", "19.1.1"
};
```

**Default**: Auto-detect from package.json or fallback to 19.1.1

---

## Environment Variables

**Type Definition**: `/Users/mattboon/Sites/veryfront-renderer/src/config/runtime-env.ts`

### Core Environment Variables

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `NODE_ENV` / `DENO_ENV` | string | `"development"` | Runtime mode |
| `VERYFRONT_ENV` | string | NODE_ENV | Veryfront-specific mode |
| `VERYFRONT_DEBUG` | boolean | `false` | Enable debug logging |
| `PORT` | number | `3001` | Server port |

### API Configuration

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `VERYFRONT_API_BASE_URL` | string | `http://api.lvh.me:4000` | API endpoint |
| `VERYFRONT_API_TOKEN` | string | undefined | Authentication token |
| `VERYFRONT_PROJECT_SLUG` | string | undefined | Project identifier |
| `PROXY_MODE` | `"0"` or `"1"` | `"0"` | Enable proxy mode |
| `PRODUCTION_MODE` | `"0"` or `"1"` | `"0"` | Use releases vs draft |

### Cache Configuration

| Variable | Type | Purpose |
|----------|------|---------|
| `REDIS_URL` | string | Redis cache connection |
| `VERYFRONT_CACHE_DIR` / `VF_CACHE_DIR` | string | Cache directory path |
| `VF_DISABLE_LRU_INTERVAL` | `"1"` | Disable LRU cleanup |

### Performance Tuning

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `REQUEST_TIMEOUT_MS` | number | undefined | Request timeout |
| `VF_HTTP_FETCH_TIMEOUT` | number | undefined | HTTP fetch timeout |
| `SSR_MAX_CONCURRENT_TRANSFORMS` | number | `3` | Concurrent SSR transforms |
| `V8_MAX_OLD_SPACE_SIZE` | number | undefined | V8 heap size |

### Experimental Features

| Variable | Type | Purpose |
|----------|------|---------|
| `VERYFRONT_EXPERIMENTAL_RSC` | `"1"` | Enable React Server Components |

### AI Provider Keys

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | OpenAI provider |
| `ANTHROPIC_API_KEY` | Anthropic provider |
| `GOOGLE_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` | Google AI provider |

### GitHub Integration

| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | GitHub API authentication |
| `GITHUB_OWNER` | Repository owner |
| `GITHUB_REPO` | Repository name |
| `GITHUB_REF` | Branch/tag/commit |

### Observability

| Variable | Purpose |
|----------|---------|
| `VERYFRONT_OTEL` / `OTEL_TRACES_ENABLED` | Enable tracing |
| `OTEL_SERVICE_NAME` | Service name in traces |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP endpoint |
| `OTEL_TRACES_EXPORTER` | Traces exporter type |
| `OTEL_METRICS_EXPORTER` | Metrics exporter type |

---

## Convention-Based File Detection

### App Router Convention Files

Located in `app/` directory (or custom `directories.app`):

| File | Purpose | Detection Location |
|------|---------|-------------------|
| `page.tsx` | Route page component | `/Users/mattboon/Sites/veryfront-renderer/src/rendering/app-reserved.ts` |
| `layout.tsx` | Nested layout | Auto-discovered per segment |
| `loading.tsx` | Loading UI | `/Users/mattboon/Sites/veryfront-renderer/src/rendering/app-reserved.ts:8` |
| `error.tsx` | Error boundary | `/Users/mattboon/Sites/veryfront-renderer/src/rendering/app-reserved.ts:9` |
| `not-found.tsx` | 404 page | `/Users/mattboon/Sites/veryfront-renderer/src/rendering/app-reserved.ts:10` |
| `route.ts` | API route handler | `/Users/mattboon/Sites/veryfront-renderer/src/server/handlers/request/api/app-router-resolver.ts:73` |

**Reserved Component Constants**:
```typescript
// src/rendering/app-reserved.ts:7-11
export const RESERVED_COMPONENTS = {
  loading: "loading.tsx",
  error: "error.tsx",
  notFound: "not-found.tsx",
};
```

### Route File Detection

**File Locations**:
- `/Users/mattboon/Sites/veryfront-renderer/src/server/handlers/request/api/app-router-resolver.ts`
- `/Users/mattboon/Sites/veryfront-renderer/src/server/handlers/response/cors.ts`

```typescript
// src/server/handlers/request/api/app-router-resolver.ts:73-75
const candidates = ["route.tsx", "route.ts", "route.jsx", "route.js"].map(
  (n) => joinPath(current, n),
);

// src/server/handlers/response/cors.ts:48-53
private static readonly ROUTE_FILE_NAMES = [
  "route.tsx",
  "route.ts",
  "route.jsx",
  "route.js",
] as const;
```

### Pages Router Convention Files

Located in `pages/` directory (or custom `directories.pages`):

| File | Purpose |
|------|---------|
| `_app.tsx` | App wrapper |
| `_document.tsx` | Document wrapper |
| `_error.tsx` | Error page |
| `index.tsx` | Index page |
| `api/*.ts` | API routes |

### Middleware Detection

**File Locations**:
- `/Users/mattboon/Sites/veryfront-renderer/src/server/dev-server/middleware.ts`

```typescript
// src/server/dev-server/middleware.ts:92
const middlewareFiles = ["middleware.ts", "middleware.js", "middleware.mjs"];
```

### Layout Auto-Discovery

**File Locations**:
- `/Users/mattboon/Sites/veryfront-renderer/src/rendering/layouts/layout-collector.ts`
- `/Users/mattboon/Sites/veryfront-renderer/src/rendering/layouts/types.ts`

**Valid Extensions**:
```typescript
// src/rendering/layouts/types.ts
export const LAYOUT_EXTENSIONS = ["tsx", "jsx", "ts", "js", "mdx", "md"];
```

**Discovery Order**:
1. Check frontmatter `layout` key
2. Check `config.layout` setting
3. Discover nested layouts in route segments
4. Fallback to `components/layout.{ext}`

```typescript
// src/rendering/layouts/layout-collector.ts:321-339
const foundExt = await parallelFind([...LAYOUT_EXTENSIONS], async (ext) => {
  const layoutPath = join(this.projectDir, "components", `layout.${ext}`);
  return await existsFn.call(wrappedAdapter, layoutPath);
});

if (foundExt) {
  const defaultLayoutPath = join(this.projectDir, "components", `layout.${foundExt}`);
  // ... add to nestedLayouts
}
```

---

## Directory Structure Expectations

### Standard Directories

**Detection Location**: `/Users/mattboon/Sites/veryfront-renderer/src/cli/mcp/advanced-tools.ts`

```typescript
// src/cli/mcp/advanced-tools.ts:236-254
const STANDARD_DIRS = [
  "app", "pages", "components", "lib", "utils", "hooks", "styles", "public",
  "content", "docs", "data", "types", "tests", "ai", "agents", "tools", "prompts",
  "workflows"
];
```

### AI Directory Detection

```typescript
// src/cli/mcp/advanced-tools.ts:323-324
const hasAI = await directoryExists(join(projectDir, "ai")) ||
  await fileExists(join(projectDir, "app/api/chat/route.ts"));
```

### Project Type Detection via Features

**Detection Location**: `/Users/mattboon/Sites/veryfront-renderer/src/cli/mcp/advanced-tools.ts:1248-1256`

```typescript
const hasAppDir = await directoryExists(join(projectPath, "app"));
const hasAIDir = await directoryExists(join(projectPath, "ai"));
const hasChatRoute = await fileExists(join(projectPath, "app/api/chat/route.ts"));
const hasBlogDir = await directoryExists(join(projectPath, "app/blog")) ||
  await directoryExists(join(projectPath, "content"));
const hasDocsDir = await directoryExists(join(projectPath, "app/docs")) ||
  await directoryExists(join(projectPath, "docs"));
```

---

## Configuration Interaction Matrix

### Router Selection Interactions

| config.router | app/ exists | pages/ exists | Result |
|---------------|-------------|---------------|--------|
| `"app"` | Any | Any | App Router |
| `"pages"` | Any | Any | Pages Router |
| undefined | Yes (with routes) | Any | App Router |
| undefined | No | Yes (with routes) | Pages Router |
| undefined | No | No | App Router (default) |

### Layout Resolution Interactions

| Frontmatter | config.layout | components/layout.* | Result |
|-------------|---------------|---------------------|--------|
| `layout: false` | Any | Any | No layout |
| `layout: "custom.tsx"` | Any | Any | Use frontmatter path |
| undefined | `false` | Any | No layout |
| undefined | `"custom.tsx"` | Any | Use config path |
| undefined | undefined | Exists | Use discovered layout |
| undefined | undefined | Not found | No layout |

### Filesystem Adapter Selection

| config.fs.type | proxyMode | Headers Present | Adapter Used |
|----------------|-----------|-----------------|--------------|
| `"local"` | N/A | N/A | RuntimeAdapter.fs (built-in) |
| `"veryfront-api"` | false | N/A | VeryfrontFSAdapter |
| `"veryfront-api"` | true | Yes | MultiProjectFSAdapter |
| `"github"` | N/A | N/A | GitHubFSAdapter |
| `"memory"` | N/A | N/A | MemoryFSAdapter |

### Cache Type Selection

| config.cache.render.type | Environment | Store Created |
|--------------------------|-------------|---------------|
| `"memory"` (default) | Any | MemoryCacheStore |
| `"filesystem"` | Any | FilesystemCacheStore |
| `"kv"` | Deno Deploy | KVCacheStore |
| `"redis"` | Redis available | RedisCacheStore |

---

## Summary

The veryfront-renderer configuration system provides extensive customization through:

1. **Explicit Configuration** (`veryfront.config.ts`) - 20+ top-level options
2. **Environment Variables** - 40+ recognized variables
3. **Convention-Based Detection** - 15+ special file names
4. **Directory Conventions** - 20+ recognized directories

Key architectural decisions:
- **Config takes precedence** over auto-detection
- **Frontmatter takes precedence** over global config for layouts
- **Environment variables** can override some config options (e.g., `experimental.rsc`)
- **Proxy mode** fundamentally changes filesystem adapter behavior
- **Router detection** affects nearly all rendering code paths

When debugging issues, check:
1. What `router` mode is active?
2. What `fs.type` is configured?
3. Are layouts being discovered or explicitly configured?
4. What cache stores are in use?
5. Are experimental features enabled?
