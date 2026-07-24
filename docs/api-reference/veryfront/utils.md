---
title: "veryfront/utils"
description: "Runtime detection, logging, constants, hashing, and feature flags."
order: 36
---

## Import

```ts
import {
  __registerLogRecordEmitter,
  __registerTraceContextGetter,
  base64urlEncode,
  base64urlEncodeBytes,
  computeCodeHash,
  computeHash,
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
| `DEFAULT_LRU_MAX_ENTRIES` | Default value for lru max entries. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cache.ts#L77) |
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
| `MAX_TIMER_DELAY_MS` | Largest delay supported consistently by JavaScript timer implementations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/limits.ts#L34) |
| `MS_PER_SECOND` | Shared ms per second value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cache.ts#L7) |
| `PREFETCH_DEFAULT_DELAY_MS` | Shared prefetch default delay ms value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L24) |
| `PREFETCH_DEFAULT_TIMEOUT_MS` | Shared prefetch default timeout ms value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L22) |
| `PREFETCH_MAX_SIZE_BYTES` | Shared prefetch max size bytes value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/http.ts#L20) |
| `REACT_DEFAULT_VERSION` | Shared React default version value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cdn.ts#L12) |
| `RESPONSIVE_IMAGE_WIDTH_LG` | Shared responsive image width lg value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/network.ts#L19) |
| `RESPONSIVE_IMAGE_WIDTHS` | Shared responsive image widths value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/network.ts#L22) |
| `RSC_MANIFEST_CACHE_TTL_MS` | Shared RSC manifest cache ttl ms value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cache.ts#L117) |
| `TSX_LAYOUT_MAX_ENTRIES` | Shared TSX layout max entries value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cache.ts#L89) |
| `TSX_LAYOUT_PER_PROJECT_MAX_ENTRIES` | Per-project cap for the TSX layout component cache. Prevents a single noisy tenant from evicting every other project's cached layouts. Defaults to ceil(TSX_LAYOUT_MAX_ENTRIES / 10) so no one project consumes more than ~10 % of the global budget. Set via TSX_LAYOUT_PER_PROJECT_MAX_ENTRIES env var. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cache.ts#L99) |
| `VERSION` | Shared version value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/version-constant.ts#L4) |
| `Z_INDEX_DEV_INDICATOR` | Shared z index dev indicator value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/html.ts#L2) |
| `Z_INDEX_ERROR_OVERLAY` | Shared z index error overlay value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/html.ts#L4) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `__registerLogRecordEmitter` | Register a process-level structured log emitter, for example an OTel bridge. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L204) |
| `__registerTraceContextGetter` | Register the trace context getter. Called by trace-bridge.ts after OTLP initialization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L734) |
| `base64urlEncode` | Encode a UTF-8 string as unpadded base64url. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/base64url.ts#L59) |
| `base64urlEncodeBytes` | Encode raw bytes as unpadded base64url. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/base64url.ts#L64) |
| `computeCodeHash` | Compute code hash. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/hash-utils.ts#L29) |
| `computeHash` | Compute the lowercase hex SHA-256 digest of a UTF-8 string. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/hash-utils.ts#L12) |
| `computeHashBytes` | Compute the lowercase hex SHA-256 digest of raw bytes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/hash-utils.ts#L18) |
| `computeIntegrity` | Compute integrity. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/import-lockfile.ts#L112) |
| `createLockfileManager` | Create lockfile manager. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/import-lockfile.ts#L191) |
| `createRunUserLogger` | Create run user logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L864) |
| `createSubscriberSet` | Create a subscriber set: the canonical subscribe/notify observable used across modules. Notification iterates a snapshot, so a listener that unsubscribes (itself or others) mid-notify is safe, and listener errors are isolated (routed to `onListenerError` when provided, otherwise swallowed). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/subscriber-set.ts#L19) |
| `encodeBase64` | Encode a string as standard base64. Latin-1 input (all code points <= 0xFF) is encoded with btoa's binary-string semantics; input outside Latin-1 falls back to UTF-8 bytes. Callers that need guaranteed UTF-8 bytes regardless of input (e.g. data: URLs decoded as UTF-8) should use `encodeBase64Bytes(new TextEncoder().encode(value))` instead. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/base64url.ts#L18) |
| `encodeBase64Bytes` | Encode raw bytes as standard base64. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/base64url.ts#L36) |
| `endRequest` | Request payload for end. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/perf-timer.ts#L115) |
| `fnv1aHash` | FNV-1a hash for strings - returns hex string | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/hash-utils.ts#L61) |
| `getBaseLogger` | Get the base logger without request context awareness. Use this when you need to create a request-scoped logger in middleware. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L834) |
| `getBundleManifestStore` | Return bundle manifest store. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/bundle-manifest.ts#L389) |
| `getDenoStdNodeBase` | Return Deno std node base. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cdn.ts#L82) |
| `getReactImportMap` | Return React import map. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/constants/cdn.ts#L46) |
| `hasBunRuntime` | Check whether Bun runtime is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/runtime-guards.ts#L53) |
| `hasDenoRuntime` | Check whether Deno runtime is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/runtime-guards.ts#L31) |
| `hasNodeProcess` | Check whether node process is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/runtime-guards.ts#L42) |
| `isCompiledBinary` | Detect if the code is running in a compiled Deno binary | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/platform.ts#L11) |
| `isEnabled` | Check whether request performance timing is enabled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/perf-timer.ts#L191) |
| `isRSCEnabled` | Check whether RSC is enabled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/feature-flags.ts#L4) |
| `memoize` | Memoize. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/memoize.ts#L79) |
| `memoizeAsync` | Memoize async. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/memoize.ts#L71) |
| `memoizeHash` | FNV-1a hash algorithm for fast, framed cache key generation. 10-15x faster than JSON.stringify() and uses 70-80% less memory. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/memoize.ts#L90) |
| `normalizePath` | Normalizes path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/path-utils.ts#L11) |
| `normalizeTimerDurationMs` | Normalize a requested delay to the portable JavaScript timer domain. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/timer.ts#L12) |
| `parallelMap` | Run parallel map. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/parallel.ts#L44) |
| `redactForSerialization` | Returns a JSON-safe redacted snapshot of `context`. Sensitive keys are masked, nested values are traversed, BigInts become decimal strings, non-finite numbers become `null`, and unsupported or unreadable values fail closed. Objects with `toJSON` are snapshotted exactly once before redaction. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/redact.ts#L298) |
| `redactSensitive` | Returns a redacted copy of `context` while preserving the established source and runtime value shapes. Any property whose key is `isSensitiveKey` is replaced with `REDACTED`; nested records and arrays are traversed, while primitives and scalar-serializing objects retain their original types. The input is never mutated. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/redact.ts#L285) |
| `refreshLoggerConfig` | Re-read logger configuration from environment variables. Call after loading .env files so the logger picks up any overrides. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L193) |
| `registerTraceContextGetter` | Register the trace context getter. Called by trace-bridge.ts after OTLP initialization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L734) |
| `runWithRequestContextAsync` | Run with request context async. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/request-context.ts#L39) |
| `safeJsonParse` | Parse `value` as JSON without throwing; failures return `{ ok: false, error }` so callers handle them without a surrounding try/catch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/json.ts#L16) |
| `sanitizeUrlCredentials` | Strip credentials from URL-shaped strings so they can be safely emitted in free-form text (error messages, stacks, lifted `request_url` fields). Unlike `redactSensitive`, which is key-based, this scrubs secrets embedded in the *value* itself: | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/redact.ts#L571) |
| `sanitizeUrlForSpan` | Return the URL form safe to attach to observability span attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/redact.ts#L693) |
| `shortHash` | Create short hash. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/hash-utils.ts#L55) |
| `simpleHash` | Create simple hash. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/hash-utils.ts#L38) |
| `sleep` | Resolve after `ms` milliseconds; rejects with `abortSignal.reason` if aborted first. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/sleep.ts#L4) |
| `startRequest` | Request payload for start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/perf-timer.ts#L55) |
| `startTimer` | Starts timer. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/perf-timer.ts#L63) |
| `timeAsync` | Time async. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/perf-timer.ts#L82) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `MemoCache` | Implement memo cache. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/memoize.ts#L5) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `BundleCode` | Public API contract for bundle code. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/bundle-manifest.ts#L35) |
| `BundleMetadata` | Public API contract for bundle metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/bundle-manifest.ts#L7) |
| `GlobalWithBun` | Public API contract for global with Bun. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/runtime-guards.ts#L20) |
| `GlobalWithDeno` | Public API contract for global with Deno. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/runtime-guards.ts#L2) |
| `GlobalWithProcess` | Public API contract for global with process. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/runtime-guards.ts#L11) |
| `HashBundleCode` | Source bundle content used for hash computation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/hash-utils.ts#L22) |
| `LockfileManager` | Public API contract for lockfile manager. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/import-lockfile.ts#L123) |
| `LogEntry` | Structured log entry for JSON output. Fields are designed for easy Grafana/Loki filtering. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L40) |
| `Logger` | Public API contract for logger. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L98) |
| `RedactedValue` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/redact.ts#L107) |
| `RequestContext` | Context for request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/request-context.ts#L14) |
| `SafeJsonParseResult` | Tagged-union result of `safeJsonParse`; narrow via the `ok` discriminant. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/json.ts#L8) |
| `SubscriberSet` | Listener registry returned by `createSubscriberSet`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/subscriber-set.ts#L2) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `agentLogger` | Shared agent logger value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L825) |
| `bundlerLogger` | Shared bundler logger value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L823) |
| `cliLogger` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L817) |
| `logger` | Shared logger value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L828) |
| `rendererLogger` | Shared renderer logger value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L821) |
| `serverLogger` | Shared server logger value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/utils/logger/logger.ts#L819) |
