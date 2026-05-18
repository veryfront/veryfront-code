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

| Name | Description |
|------|-------------|
| `BREAKPOINT_LG` |  |
| `BREAKPOINT_MD` |  |
| `BREAKPOINT_SM` |  |
| `BREAKPOINT_XL` |  |
| `BYTES_PER_KB` |  |
| `DEFAULT_ALLOWED_CDN_HOSTS` |  |
| `DEFAULT_BUILD_CONCURRENCY` |  |
| `DEFAULT_DASHBOARD_PORT` | Default port for development dashboard (matches veryfront.config.ts default) |
| `DEFAULT_LRU_MAX_ENTRIES` |  |
| `DEV_SERVER_ENDPOINTS` |  |
| `FORBIDDEN_PATH_PATTERNS` |  |
| `HASH_SEED_DJB2` |  |
| `HASH_SEED_FNV1A` |  |
| `HMR_CLIENT_RELOAD_DELAY_MS` |  |
| `HMR_CLOSE_MESSAGE_TOO_LARGE` |  |
| `HMR_CLOSE_NORMAL` |  |
| `HMR_CLOSE_RATE_LIMIT` |  |
| `HMR_MAX_MESSAGE_SIZE_BYTES` |  |
| `HMR_MAX_MESSAGES_PER_MINUTE` |  |
| `HMR_RATE_LIMIT_WINDOW_MS` |  |
| `HTTP_BAD_REQUEST` |  |
| `HTTP_CONTENT_TYPE_IMAGE_GIF` |  |
| `HTTP_CONTENT_TYPE_IMAGE_ICO` |  |
| `HTTP_CONTENT_TYPE_IMAGE_JPEG` |  |
| `HTTP_CONTENT_TYPE_IMAGE_PNG` |  |
| `HTTP_CONTENT_TYPE_IMAGE_SVG` |  |
| `HTTP_CONTENT_TYPE_IMAGE_WEBP` |  |
| `HTTP_CONTENT_TYPES` |  |
| `HTTP_MODULE_FETCH_TIMEOUT_MS` |  |
| `HTTP_NETWORK_CONNECT_TIMEOUT` |  |
| `HTTP_NOT_FOUND` |  |
| `HTTP_NOT_IMPLEMENTED` |  |
| `HTTP_OK` |  |
| `HTTP_REDIRECT_FOUND` |  |
| `HTTP_SERVER_ERROR` |  |
| `HTTP_STATUS_CLIENT_ERROR_MIN` |  |
| `HTTP_STATUS_REDIRECT_MIN` |  |
| `HTTP_STATUS_SERVER_ERROR_MIN` |  |
| `HTTP_STATUS_SUCCESS_MIN` |  |
| `HTTP_UNAVAILABLE` |  |
| `IMAGE_OPTIMIZATION` |  |
| `MAX_BATCH_SIZE` | ****** Batch limits ******* |
| `MAX_PATH_LENGTH` |  |
| `MAX_PATH_TRAVERSAL_DEPTH` |  |
| `MS_PER_SECOND` |  |
| `PREFETCH_DEFAULT_DELAY_MS` |  |
| `PREFETCH_DEFAULT_TIMEOUT_MS` |  |
| `PREFETCH_MAX_SIZE_BYTES` |  |
| `REACT_DEFAULT_VERSION` |  |
| `RESPONSIVE_IMAGE_WIDTH_LG` |  |
| `RESPONSIVE_IMAGE_WIDTHS` |  |
| `RSC_MANIFEST_CACHE_TTL_MS` |  |
| `TSX_LAYOUT_MAX_ENTRIES` |  |
| `VERSION` |  |
| `Z_INDEX_DEV_INDICATOR` |  |
| `Z_INDEX_ERROR_OVERLAY` |  |

### Functions

| Name | Description |
|------|-------------|
| `__registerTraceContextGetter` | Register the trace context getter. |
| `computeCodeHash` |  |
| `computeHash` |  |
| `computeIntegrity` |  |
| `createJobUserLogger` |  |
| `createLockfileManager` |  |
| `endRequest` |  |
| `fnv1aHash` | FNV-1a hash for strings - returns hex string |
| `getBundleManifestStore` |  |
| `getDenoStdNodeBase` |  |
| `getReactImportMap` |  |
| `hasBunRuntime` |  |
| `hasDenoRuntime` |  |
| `hasNodeProcess` |  |
| `isCompiledBinary` | Detect if the code is running in a compiled Deno binary |
| `isEnabled` |  |
| `isRSCEnabled` |  |
| `memoize` |  |
| `memoizeAsync` |  |
| `memoizeHash` | FNV-1a hash algorithm for fast cache key generation. |
| `normalizePath` |  |
| `parallelMap` |  |
| `refreshLoggerConfig` | Re-read logger configuration from environment variables. |
| `runWithRequestContextAsync` |  |
| `shortHash` |  |
| `simpleHash` |  |
| `startRequest` |  |
| `startTimer` |  |
| `timeAsync` |  |

### Classes

| Name | Description |
|------|-------------|
| `MemoCache` |  |

### Types

| Name | Description |
|------|-------------|
| `BundleCode` |  |
| `BundleMetadata` |  |
| `GlobalWithBun` |  |
| `GlobalWithDeno` |  |
| `GlobalWithProcess` |  |
| `HashBundleCode` |  |
| `LockfileManager` |  |
| `Logger` |  |
| `RequestContext` |  |

### Constants

| Name | Description |
|------|-------------|
| `agentLogger` |  |
| `bundlerLogger` |  |
| `logger` |  |
| `rendererLogger` |  |
| `serverLogger` |  |
