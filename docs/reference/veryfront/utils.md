---
title: "veryfront/utils"
description: "Internal utilities — runtime detection, structured logging, constants (breakpoints, timeouts, HTTP codes), hashing, memoization, and feature flags."
order: 18
---

# veryfront/utils

Internal utilities — runtime detection, structured logging, constants (breakpoints, timeouts, HTTP codes), hashing, memoization, and feature flags.

## Import

```ts
import {
  __registerTraceContextGetter,
  computeCodeHash,
  computeHash,
  computeIntegrity,
  createJobUserLogger,
  createLockfileManager,
} from "veryfront/utils";
```

## Examples

### Structured logging

```ts
import { serverLogger } from "veryfront/utils";

serverLogger.info("Booting server", { project_id: "proj_123" });
```

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `BREAKPOINT_LG` | Shared breakpoint lg value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/html.ts#L11) |
| `BREAKPOINT_MD` | Shared breakpoint md value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/html.ts#L9) |
| `BREAKPOINT_SM` | Shared breakpoint sm value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/html.ts#L7) |
| `BREAKPOINT_XL` | Shared breakpoint xl value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/html.ts#L13) |
| `BYTES_PER_KB` | Shared bytes per kb value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/network.ts#L8) |
| `DEFAULT_ALLOWED_CDN_HOSTS` | Default value for allowed cdn hosts. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cdn.ts#L77) |
| `DEFAULT_BUILD_CONCURRENCY` | Default value for build concurrency. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/build.ts#L2) |
| `DEFAULT_DASHBOARD_PORT` | Default port for development dashboard (matches veryfront.config.ts default) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/server.ts#L11) |
| `DEFAULT_LRU_MAX_ENTRIES` | Default value for lru max entries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cache.ts#L45) |
| `DEV_SERVER_ENDPOINTS` | Shared dev server endpoints value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/server.ts#L135) |
| `FORBIDDEN_PATH_PATTERNS` | Shared forbidden path patterns value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/security.ts#L4) |
| `HASH_SEED_DJB2` | Shared hash seed djb2 value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/hash.ts#L2) |
| `HASH_SEED_FNV1A` | Shared hash seed fnv1 a value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/hash.ts#L4) |
| `HMR_CLIENT_RELOAD_DELAY_MS` | Shared HMR client reload delay ms value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/hmr.ts#L8) |
| `HMR_CLOSE_MESSAGE_TOO_LARGE` | Shared HMR close message too large value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/hmr.ts#L17) |
| `HMR_CLOSE_NORMAL` | Shared HMR close normal value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/hmr.ts#L13) |
| `HMR_CLOSE_RATE_LIMIT` | Shared HMR close rate limit value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/hmr.ts#L15) |
| `HMR_MAX_MESSAGE_SIZE_BYTES` | Shared HMR max message size bytes value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/hmr.ts#L4) |
| `HMR_MAX_MESSAGES_PER_MINUTE` | Shared HMR max messages per minute value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/hmr.ts#L6) |
| `HMR_RATE_LIMIT_WINDOW_MS` | Shared HMR rate limit window ms value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/hmr.ts#L11) |
| `HTTP_BAD_REQUEST` | Shared HTTP bad request value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L35) |
| `HTTP_CONTENT_TYPE_IMAGE_GIF` | Shared HTTP content type image gif value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L87) |
| `HTTP_CONTENT_TYPE_IMAGE_ICO` | Shared HTTP content type image ico value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L89) |
| `HTTP_CONTENT_TYPE_IMAGE_JPEG` | Shared HTTP content type image jpeg value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L80) |
| `HTTP_CONTENT_TYPE_IMAGE_PNG` | Shared HTTP content type image png value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L78) |
| `HTTP_CONTENT_TYPE_IMAGE_SVG` | Shared HTTP content type image svg value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L85) |
| `HTTP_CONTENT_TYPE_IMAGE_WEBP` | Shared HTTP content type image webp value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L82) |
| `HTTP_CONTENT_TYPES` | Shared HTTP content types value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L69) |
| `HTTP_MODULE_FETCH_TIMEOUT_MS` | Shared HTTP module fetch timeout ms value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L6) |
| `HTTP_NETWORK_CONNECT_TIMEOUT` | Shared HTTP network connect timeout value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L57) |
| `HTTP_NOT_FOUND` | Shared HTTP not found value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L39) |
| `HTTP_NOT_IMPLEMENTED` | Shared HTTP not implemented value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L51) |
| `HTTP_OK` | Shared HTTP ok value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L27) |
| `HTTP_REDIRECT_FOUND` | Shared HTTP redirect found value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L31) |
| `HTTP_SERVER_ERROR` | Shared HTTP server error value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L49) |
| `HTTP_STATUS_CLIENT_ERROR_MIN` | Shared HTTP status client error min value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L64) |
| `HTTP_STATUS_REDIRECT_MIN` | Shared HTTP status redirect min value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L62) |
| `HTTP_STATUS_SERVER_ERROR_MIN` | Shared HTTP status server error min value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L66) |
| `HTTP_STATUS_SUCCESS_MIN` | Shared HTTP status success min value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L60) |
| `HTTP_UNAVAILABLE` | Shared HTTP unavailable value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L54) |
| `IMAGE_OPTIMIZATION` | Shared image optimization value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/build.ts#L5) |
| `MAX_BATCH_SIZE` | ****** Batch limits ******* | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/limits.ts#L31) |
| `MAX_PATH_LENGTH` | Maximum value for path length. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/security.ts#L16) |
| `MAX_PATH_TRAVERSAL_DEPTH` | Maximum value for path traversal depth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/security.ts#L2) |
| `MS_PER_SECOND` | Shared ms per second value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cache.ts#L5) |
| `PREFETCH_DEFAULT_DELAY_MS` | Shared prefetch default delay ms value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L24) |
| `PREFETCH_DEFAULT_TIMEOUT_MS` | Shared prefetch default timeout ms value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L22) |
| `PREFETCH_MAX_SIZE_BYTES` | Shared prefetch max size bytes value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L20) |
| `REACT_DEFAULT_VERSION` | Shared React default version value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cdn.ts#L12) |
| `RESPONSIVE_IMAGE_WIDTH_LG` | Shared responsive image width lg value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/network.ts#L19) |
| `RESPONSIVE_IMAGE_WIDTHS` | Shared responsive image widths value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/network.ts#L22) |
| `RSC_MANIFEST_CACHE_TTL_MS` | Shared RSC manifest cache ttl ms value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cache.ts#L73) |
| `TSX_LAYOUT_MAX_ENTRIES` | Shared TSX layout max entries value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cache.ts#L57) |
| `VERSION` | Shared version value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/version-constant.ts#L4) |
| `Z_INDEX_DEV_INDICATOR` | Shared z index dev indicator value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/html.ts#L2) |
| `Z_INDEX_ERROR_OVERLAY` | Shared z index error overlay value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/html.ts#L4) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `__registerTraceContextGetter` | Register the trace context getter. Called by trace-bridge.ts after OTLP initialization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L469) |
| `computeCodeHash` | Compute code hash. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/hash-utils.ts#L22) |
| `computeHash` | Compute hash. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/hash-utils.ts#L8) |
| `computeIntegrity` | Compute integrity. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/import-lockfile.ts#L28) |
| `createJobUserLogger` | Create job user logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L599) |
| `createLockfileManager` | Create lockfile manager. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/import-lockfile.ts#L76) |
| `endRequest` | Request payload for end. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/perf-timer.ts#L73) |
| `fnv1aHash` | FNV-1a hash for strings - returns hex string | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/hash-utils.ts#L50) |
| `getBundleManifestStore` | Return bundle manifest store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/bundle-manifest.ts#L160) |
| `getDenoStdNodeBase` | Return Deno std node base. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cdn.ts#L82) |
| `getReactImportMap` | Return React import map. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cdn.ts#L46) |
| `hasBunRuntime` | Check whether Bun runtime is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/runtime-guards.ts#L45) |
| `hasDenoRuntime` | Check whether Deno runtime is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/runtime-guards.ts#L31) |
| `hasNodeProcess` | Check whether node process is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/runtime-guards.ts#L38) |
| `isCompiledBinary` | Detect if the code is running in a compiled Deno binary | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/platform.ts#L12) |
| `isEnabled` | Check whether request performance timing is enabled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/perf-timer.ts#L143) |
| `isRSCEnabled` | Check whether RSC is enabled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/feature-flags.ts#L4) |
| `memoize` | Memoize. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/memoize.ts#L79) |
| `memoizeAsync` | Memoize async. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/memoize.ts#L71) |
| `memoizeHash` | FNV-1a hash algorithm for fast cache key generation. 10-15x faster than JSON.stringify() and uses 70-80% less memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/memoize.ts#L90) |
| `normalizePath` | Normalizes path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/path-utils.ts#L11) |
| `parallelMap` | Run parallel map. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/parallel.ts#L43) |
| `refreshLoggerConfig` | Re-read logger configuration from environment variables. Call after loading .env files so the logger picks up any overrides. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L165) |
| `runWithRequestContextAsync` | Run with request context async. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/request-context.ts#L39) |
| `shortHash` | Create short hash. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/hash-utils.ts#L44) |
| `simpleHash` | Create simple hash. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/hash-utils.ts#L27) |
| `startRequest` | Request payload for start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/perf-timer.ts#L36) |
| `startTimer` | Starts timer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/perf-timer.ts#L44) |
| `timeAsync` | Time async. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/perf-timer.ts#L57) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `MemoCache` | Implement memo cache. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/memoize.ts#L5) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `BundleCode` | Public API contract for bundle code. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/bundle-manifest.ts#L23) |
| `BundleMetadata` | Public API contract for bundle metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/bundle-manifest.ts#L6) |
| `GlobalWithBun` | Public API contract for global with Bun. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/runtime-guards.ts#L20) |
| `GlobalWithDeno` | Public API contract for global with Deno. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/runtime-guards.ts#L2) |
| `GlobalWithProcess` | Public API contract for global with process. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/runtime-guards.ts#L11) |
| `HashBundleCode` | Source bundle content used for hash computation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/hash-utils.ts#L15) |
| `LockfileManager` | Public API contract for lockfile manager. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/import-lockfile.ts#L39) |
| `Logger` | Public API contract for logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L80) |
| `RequestContext` | Context for request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/request-context.ts#L14) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `agentLogger` | Shared agent logger value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L560) |
| `bundlerLogger` | Shared bundler logger value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L558) |
| `logger` | Shared logger value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L563) |
| `rendererLogger` | Shared renderer logger value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L556) |
| `serverLogger` | Shared server logger value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L554) |
