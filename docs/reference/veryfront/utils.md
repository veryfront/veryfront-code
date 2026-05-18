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
| `BREAKPOINT_LG` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/html.ts#L5) |
| `BREAKPOINT_MD` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/html.ts#L4) |
| `BREAKPOINT_SM` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/html.ts#L3) |
| `BREAKPOINT_XL` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/html.ts#L6) |
| `BYTES_PER_KB` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/network.ts#L6) |
| `DEFAULT_ALLOWED_CDN_HOSTS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cdn.ts#L73) |
| `DEFAULT_BUILD_CONCURRENCY` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/build.ts) |
| `DEFAULT_DASHBOARD_PORT` | Default port for development dashboard (matches veryfront.config.ts default) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/server.ts#L10) |
| `DEFAULT_LRU_MAX_ENTRIES` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cache.ts#L42) |
| `DEV_SERVER_ENDPOINTS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/server.ts#L133) |
| `FORBIDDEN_PATH_PATTERNS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/security.ts#L1) |
| `HASH_SEED_DJB2` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/hash.ts) |
| `HASH_SEED_FNV1A` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/hash.ts#L1) |
| `HMR_CLIENT_RELOAD_DELAY_MS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/hmr.ts#L4) |
| `HMR_CLOSE_MESSAGE_TOO_LARGE` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/hmr.ts#L9) |
| `HMR_CLOSE_NORMAL` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/hmr.ts#L7) |
| `HMR_CLOSE_RATE_LIMIT` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/hmr.ts#L8) |
| `HMR_MAX_MESSAGE_SIZE_BYTES` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/hmr.ts#L2) |
| `HMR_MAX_MESSAGES_PER_MINUTE` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/hmr.ts#L3) |
| `HMR_RATE_LIMIT_WINDOW_MS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/hmr.ts#L6) |
| `HTTP_BAD_REQUEST` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L27) |
| `HTTP_CONTENT_TYPE_IMAGE_GIF` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L64) |
| `HTTP_CONTENT_TYPE_IMAGE_ICO` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L65) |
| `HTTP_CONTENT_TYPE_IMAGE_JPEG` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L60) |
| `HTTP_CONTENT_TYPE_IMAGE_PNG` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L59) |
| `HTTP_CONTENT_TYPE_IMAGE_SVG` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L63) |
| `HTTP_CONTENT_TYPE_IMAGE_WEBP` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L61) |
| `HTTP_CONTENT_TYPES` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L51) |
| `HTTP_MODULE_FETCH_TIMEOUT_MS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L4) |
| `HTTP_NETWORK_CONNECT_TIMEOUT` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L44) |
| `HTTP_NOT_FOUND` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L30) |
| `HTTP_NOT_IMPLEMENTED` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L40) |
| `HTTP_OK` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L21) |
| `HTTP_REDIRECT_FOUND` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L24) |
| `HTTP_SERVER_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L39) |
| `HTTP_STATUS_CLIENT_ERROR_MIN` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L48) |
| `HTTP_STATUS_REDIRECT_MIN` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L47) |
| `HTTP_STATUS_SERVER_ERROR_MIN` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L49) |
| `HTTP_STATUS_SUCCESS_MIN` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L46) |
| `HTTP_UNAVAILABLE` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L42) |
| `IMAGE_OPTIMIZATION` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/build.ts#L2) |
| `MAX_BATCH_SIZE` | ****** Batch limits ******* | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/limits.ts#L30) |
| `MAX_PATH_LENGTH` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/security.ts#L12) |
| `MAX_PATH_TRAVERSAL_DEPTH` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/security.ts) |
| `MS_PER_SECOND` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cache.ts#L3) |
| `PREFETCH_DEFAULT_DELAY_MS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L19) |
| `PREFETCH_DEFAULT_TIMEOUT_MS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L18) |
| `PREFETCH_MAX_SIZE_BYTES` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L17) |
| `REACT_DEFAULT_VERSION` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cdn.ts#L10) |
| `RESPONSIVE_IMAGE_WIDTH_LG` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/network.ts#L16) |
| `RESPONSIVE_IMAGE_WIDTHS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/network.ts#L18) |
| `RSC_MANIFEST_CACHE_TTL_MS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cache.ts#L68) |
| `TSX_LAYOUT_MAX_ENTRIES` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cache.ts#L53) |
| `VERSION` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/version-constant.ts#L2) |
| `Z_INDEX_DEV_INDICATOR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/html.ts) |
| `Z_INDEX_ERROR_OVERLAY` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/html.ts#L1) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `__registerTraceContextGetter` | Register the trace context getter. Called by trace-bridge.ts after OTLP initialization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L467) |
| `computeCodeHash` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/hash-utils.ts#L19) |
| `computeHash` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/hash-utils.ts#L6) |
| `computeIntegrity` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/import-lockfile.ts#L26) |
| `createJobUserLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L591) |
| `createLockfileManager` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/import-lockfile.ts#L72) |
| `endRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/perf-timer.ts#L68) |
| `fnv1aHash` | FNV-1a hash for strings - returns hex string | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/hash-utils.ts#L45) |
| `getBundleManifestStore` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/bundle-manifest.ts#L156) |
| `getDenoStdNodeBase` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cdn.ts#L77) |
| `getReactImportMap` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cdn.ts#L43) |
| `hasBunRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/runtime-guards.ts#L38) |
| `hasDenoRuntime` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/runtime-guards.ts#L26) |
| `hasNodeProcess` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/runtime-guards.ts#L32) |
| `isCompiledBinary` | Detect if the code is running in a compiled Deno binary | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/platform.ts#L11) |
| `isEnabled` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/perf-timer.ts#L137) |
| `isRSCEnabled` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/feature-flags.ts#L2) |
| `memoize` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/memoize.ts#L75) |
| `memoizeAsync` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/memoize.ts#L68) |
| `memoizeHash` | FNV-1a hash algorithm for fast cache key generation. 10-15x faster than JSON.stringify() and uses 70-80% less memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/memoize.ts#L86) |
| `normalizePath` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/path-utils.ts#L9) |
| `parallelMap` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/parallel.ts#L41) |
| `refreshLoggerConfig` | Re-read logger configuration from environment variables. Call after loading .env files so the logger picks up any overrides. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L163) |
| `registerTraceContextGetter` | Register the trace context getter. Called by trace-bridge.ts after OTLP initialization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L467) |
| `runWithRequestContextAsync` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/request-context.ts#L36) |
| `shortHash` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/hash-utils.ts#L39) |
| `simpleHash` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/hash-utils.ts#L23) |
| `startRequest` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/perf-timer.ts#L34) |
| `startTimer` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/perf-timer.ts#L41) |
| `timeAsync` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/perf-timer.ts#L53) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `MemoCache` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/memoize.ts#L3) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `BundleCode` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/bundle-manifest.ts#L20) |
| `BundleMetadata` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/bundle-manifest.ts#L4) |
| `GlobalWithBun` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/runtime-guards.ts#L16) |
| `GlobalWithDeno` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/runtime-guards.ts) |
| `GlobalWithProcess` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/runtime-guards.ts#L8) |
| `HashBundleCode` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/hash-utils.ts#L13) |
| `LockfileManager` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/import-lockfile.ts#L36) |
| `Logger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L78) |
| `RequestContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/request-context.ts#L12) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `agentLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L554) |
| `bundlerLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L553) |
| `logger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L556) |
| `rendererLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L552) |
| `serverLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L551) |
