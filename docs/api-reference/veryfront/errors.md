---
title: "veryfront/errors"
description: "Structured error system with slug-based registry, RFC 9457 HTTP problem details, error boundaries for HTTP and CLI, and user-friendly formatting."
order: 7
---

## Import

```ts
import {
  attachErrorToActiveSpan,
  attachErrorToSpan,
  cliErrorBoundary,
  cliErrorBoundarySync,
  createError,
  createErrorHandler,
} from "veryfront/errors";
```

## Examples

### Define and create a structured framework error

```ts
import { defineError } from "veryfront/errors";

const INVALID_WIDGET = defineError({
  slug: "invalid-widget",
  category: "GENERAL",
  title: "Invalid widget",
  status: 400,
});
throw INVALID_WIDGET.create({ detail: "The widget id is malformed." });
```

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `AGENT_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/agent.ts#L3) |
| `AGENT_INTENT_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/agent.ts#L27) |
| `AGENT_NOT_FOUND` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/agent.ts#L11) |
| `AGENT_TIMEOUT` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/agent.ts#L19) |
| `API_CLIENT_ERROR` | API client request/response errors (replaces VeryfrontAPIError) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/server.ts#L84) |
| `API_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/runtime.ts#L43) |
| `API_ROUTE_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/route.ts#L43) |
| `ASSET_OPTIMIZATION_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/build.ts#L35) |
| `AUTHENTICATION_REQUIRED` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L11) |
| `BRANCH_NOT_FOUND` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/deploy.ts#L91) |
| `BUILD_ERROR_CATALOG` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/catalog/build-errors.ts#L4) |
| `BUILD_FAILED` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/build.ts#L3) |
| `BUNDLE_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/build.ts#L11) |
| `CACHE_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/server.ts#L19) |
| `CACHE_INVARIANT_VIOLATION` | Cache path invariant violations (replaces CacheInvariantError) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/server.ts#L102) |
| `CACHE_PATH_MISMATCH` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/server.ts#L67) |
| `CIRCUIT_BREAKER_OPEN` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/server.ts#L59) |
| `CIRCULAR_DEPENDENCY` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/module.ts#L19) |
| `CLIENT_BOUNDARY_VIOLATION` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/boundary.ts#L3) |
| `CLIENT_ONLY_IN_SERVER` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/boundary.ts#L19) |
| `COMPILATION_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/build.ts#L59) |
| `COMPONENT_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/runtime.ts#L19) |
| `CONFIG_ERROR_CATALOG` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/catalog/config-errors.ts#L4) |
| `CONFIG_INVALID` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/config.ts#L11) |
| `CONFIG_NOT_FOUND` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/config.ts#L3) |
| `CONFIG_PARSE_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/config.ts#L19) |
| `CONFIG_TYPE_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/config.ts#L36) |
| `CONFIG_VALIDATION_ERROR` | Schema-level config validation (e.g. Zod schema mismatch at runtime) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/config.ts#L28) |
| `CONFIG_VALIDATION_FAILED` | Config file validation failures (replaces ConfigValidationError) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/config.ts#L61) |
| `CORS_CONFIG_INVALID` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/config.ts#L52) |
| `COST_LIMIT_EXCEEDED` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/agent.ts#L43) |
| `DEPENDENCY_MISSING` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/module.ts#L35) |
| `DEPLOYMENT_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/deploy.ts#L3) |
| `DEPLOYMENT_ERROR_CATALOG` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/catalog/deployment-errors.ts#L4) |
| `DEPLOYMENT_VERIFICATION_TIMEOUT` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/deploy.ts#L59) |
| `DEV_ERROR_CATALOG` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/catalog/dev-errors.ts#L4) |
| `DEV_SERVER_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/dev.ts#L11) |
| `DYNAMIC_ROUTE_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/route.ts#L27) |
| `ENV_VAR_MISSING` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/deploy.ts#L19) |
| `ENVIRONMENT_NOT_FOUND` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/deploy.ts#L35) |
| `ERROR_CATALOG` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/catalog/index.ts#L21) |
| `ERROR_OVERLAY_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/dev.ts#L27) |
| `ERROR_REGISTRY` | Central registry mapping every error slug to its definition. Assembled from the per-category registry fragments. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry.ts#L38) |
| `ERROR_SOLUTIONS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/user-friendly/error-catalog.ts#L5) |
| `FALLBACK_EXHAUSTED` | Both primary and fallback operations failed (replaces FallbackExecutionError) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/server.ts#L120) |
| `FAST_REFRESH_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/dev.ts#L19) |
| `FILE_NOT_FOUND` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L27) |
| `FILE_WATCH_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/server.ts#L27) |
| `GENERAL_ERROR_CATALOG` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/catalog/general-errors.ts#L4) |
| `HMR_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/dev.ts#L3) |
| `HYDRATION_MISMATCH` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/runtime.ts#L3) |
| `IMPORT_MAP_INVALID` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/config.ts#L44) |
| `IMPORT_RESOLUTION_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/module.ts#L11) |
| `INITIALIZATION_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L60) |
| `INPUT_VALIDATION_FAILED` | HTTP request input validation failures (replaces ValidationError) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L86) |
| `INVALID_ARGUMENT` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L43) |
| `INVALID_IMPORT` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/module.ts#L27) |
| `INVALID_ROUTE_FILE` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/route.ts#L11) |
| `INVALID_USE_CLIENT` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/boundary.ts#L27) |
| `INVALID_USE_SERVER` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/boundary.ts#L35) |
| `LAYOUT_NOT_FOUND` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/runtime.ts#L27) |
| `MDX_COMPILE_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/build.ts#L27) |
| `MIDDLEWARE_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/runtime.ts#L51) |
| `MODULE_ERROR_CATALOG` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/catalog/module-errors.ts#L4) |
| `MODULE_NOT_FOUND` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/module.ts#L3) |
| `NETWORK_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/server.ts#L75) |
| `NOT_SUPPORTED` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L68) |
| `ORCHESTRATION_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/agent.ts#L35) |
| `PAGE_NOT_FOUND` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/runtime.ts#L35) |
| `PERMISSION_DENIED` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L19) |
| `PLATFORM_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/deploy.ts#L11) |
| `PORT_IN_USE` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/server.ts#L3) |
| `PREVIEW_HOSTNAME_TOO_LONG` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/deploy.ts#L83) |
| `PROBLEM_JSON_CONTENT_TYPE` | Content-Type header for RFC 9457 responses | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/http-error.ts#L21) |
| `PRODUCTION_BUILD_REQUIRED` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/deploy.ts#L27) |
| `PROJECT_SOURCE_EMPTY` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L94) |
| `PUSH_RECEIPT_MISSING` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/deploy.ts#L67) |
| `RELEASE_BUILD_TIMEOUT` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/deploy.ts#L51) |
| `RELEASE_MISSING_VERSION` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/deploy.ts#L43) |
| `RELEASE_NOT_FOUND` | Production domain resolved but no active release found | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/server.ts#L111) |
| `RENDER_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/runtime.ts#L11) |
| `REQUEST_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/server.ts#L35) |
| `RESOURCE_NOT_FOUND` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L35) |
| `ROUTE_CONFLICT` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/route.ts#L3) |
| `ROUTE_ERROR_CATALOG` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/catalog/route-errors.ts#L4) |
| `ROUTE_HANDLER_INVALID` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/route.ts#L19) |
| `ROUTE_PARAMS_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/route.ts#L35) |
| `RSC_ERROR_CATALOG` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/catalog/rsc-errors.ts#L4) |
| `RSC_PAYLOAD_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/boundary.ts#L43) |
| `RUNTIME_ERROR_CATALOG` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/catalog/runtime-errors.ts#L4) |
| `SCHEDULE_CONFIG_INVALID` | Schedule definition validation failures (required fields, cron, concurrencyPolicy, target) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/config.ts#L79) |
| `SECURITY_VIOLATION` | Path traversal / secure-fs violations (replaces SecurityError) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L77) |
| `SEMAPHORE_TIMEOUT` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/server.ts#L51) |
| `SERVER_ERROR_CATALOG` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/catalog/server-errors.ts#L4) |
| `SERVER_ONLY_IN_CLIENT` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/boundary.ts#L11) |
| `SERVER_START_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/server.ts#L11) |
| `SERVICE_OVERLOADED` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/server.ts#L43) |
| `SOURCE_DIGEST_MISMATCH` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/deploy.ts#L75) |
| `SOURCE_MAP_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/dev.ts#L35) |
| `SOURCEMAP_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/build.ts#L51) |
| `SSG_GENERATION_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/build.ts#L43) |
| `TIMEOUT_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L52) |
| `TOKEN_STORAGE_ERROR` | Token storage adapter failures (replaces TokenStorageError) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/server.ts#L93) |
| `TOOL_ID_CONFLICT` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/agent.ts#L51) |
| `TRIGGER_CONFIG_INVALID` | Trigger ID format and input serialization validation failures | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/config.ts#L89) |
| `TRIGGER_EXECUTION_FAILED` | Trigger target task or workflow failed during local run | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/runtime.ts#L69) |
| `TRIGGER_NOT_SUPPORTED` | Trigger target type is not supported in the current runtime context | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/runtime.ts#L78) |
| `TRIGGER_TARGET_NOT_FOUND` | Trigger target (task or workflow) not found during local run | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/runtime.ts#L60) |
| `TYPESCRIPT_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/build.ts#L19) |
| `UNKNOWN_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L3) |
| `VERSION_MISMATCH` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/module.ts#L43) |
| `WEBHOOK_CONFIG_INVALID` | Webhook definition validation failures (required fields, target, eventFilter) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/config.ts#L70) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `attachErrorToActiveSpan` | Attach error to the currently active span (if any) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/tracing.ts#L82) |
| `attachErrorToSpan` | Attach error metadata to an OpenTelemetry span | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/tracing.ts#L38) |
| `cliErrorBoundary` | CLI error boundary - wraps a handler function and catches errors | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/middleware/cli-error-boundary.ts#L118) |
| `cliErrorBoundarySync` | Synchronous version of CLI error boundary | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/middleware/cli-error-boundary.ts#L156) |
| `createError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/veryfront-error.ts#L81) |
| `createErrorHandler` | Express/Hono-style error handler middleware factory | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/http-error.ts#L127) |
| `createErrorResponse` | Create an RFC 9457 compliant error Response | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/http-error.ts#L26) |
| `createErrorResponseFromDefinition` | Create an RFC 9457 error Response from a registered error definition | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/http-error.ts#L40) |
| `createErrorScope` | Create a scoped error context helper for multiple related operations | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-context.ts#L135) |
| `createErrorSolution` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/catalog/factory.ts#L6) |
| `createProblemResponse` | Create an RFC 9457 error Response from raw parameters | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/http-error.ts#L55) |
| `createSimpleError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/catalog/factory.ts#L17) |
| `defineError` | Define an error in the registry | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/types.ts#L68) |
| `ensureError` | Ensure error is an Error instance | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/veryfront-error.ts#L145) |
| `errorToResponse` | Convert any error to an RFC 9457 Response | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/http-error.ts#L97) |
| `errorToRFC9457Response` | Convert any error to an RFC 9457 Response with environment-aware filtering | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/middleware/http-error-boundary.ts#L91) |
| `formatCLIError` | Format any error for CLI output | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/middleware/cli-error-boundary.ts#L87) |
| `formatErrorLog` | Log format for errors (matches the plan's log format spec) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/http-error.ts#L143) |
| `formatUserError` | Format error with plain text (existing behavior) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/user-friendly/error-formatter.ts#L68) |
| `fromError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/veryfront-error.ts#L124) |
| `getAllSlugs` | Get all registered slugs | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry.ts#L71) |
| `getErrorBySlug` | Get an error definition by slug | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry.ts#L57) |
| `getErrorMessage` | Extract error message from any error type | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/veryfront-error.ts#L137) |
| `getErrorsByCategory` | Get all errors in a category | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry.ts#L64) |
| `getErrorSolution` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/catalog/index.ts#L34) |
| `handleErrorWithFallback` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-handlers.ts#L22) |
| `handleErrorWithFallbackSync` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-handlers.ts#L35) |
| `httpErrorBoundary` | Wrap a handler with error boundary that catches all errors and converts them to RFC 9457 Problem Details responses. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/middleware/http-error-boundary.ts#L39) |
| `identifyError` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/user-friendly/error-identifier.ts#L1) |
| `isVeryfrontError` | Check if an error is a VeryfrontError with slug-based identity | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/http-error.ts#L87) |
| `logError` | Log a VeryfrontError with structured formatting | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/logging.ts#L53) |
| `logErrorWithMessage` | Log an error with a custom message prefix | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/logging.ts#L110) |
| `retryWithBackoff` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-handlers.ts#L77) |
| `safeFileRead` | Safe file read with logging | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-context.ts#L106) |
| `safeFileStat` | Safe file stat with logging | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-context.ts#L93) |
| `safeReadDir` | Safe directory read with logging | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-context.ts#L119) |
| `searchErrors` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/catalog/index.ts#L38) |
| `toError` | Convert a VeryfrontErrorData (plain object) to a throwable Error instance. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/veryfront-error.ts#L107) |
| `withErrorContext` | Execute async operation with error logging and fallback | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-context.ts#L65) |
| `withErrorContextSync` | Execute sync operation with error logging and fallback | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-context.ts#L79) |
| `wrapErrorHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/user-friendly/error-wrapper.ts#L6) |
| `wrapHandlerWithErrorBoundary` | Wrap a complete Handler object with error boundary | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/middleware/http-error-boundary.ts#L78) |
| `wrapUnknownError` | Return a detached VeryfrontError, preserving safe identity fields from valid VeryfrontError inputs | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/middleware/wrap-unknown.ts#L35) |
| `wrapWithContext` | Wrap an error with additional context | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/middleware/wrap-unknown.ts#L78) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `VeryfrontError` | Veryfront Error class with slug-based error identity | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/types.ts#L104) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ConfigContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/veryfront-error.ts#L38) |
| `ErrorCatalog` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/catalog/types.ts#L14) |
| `ErrorCategory` | Error categories for domain-based grouping and handling | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/types.ts#L4) |
| `ErrorContext` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-context.ts#L9) |
| `ErrorCreateOptions` | Options for creating an error instance | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/types.ts#L47) |
| `ErrorDefinition` | Error definition for the registry | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/types.ts#L34) |
| `ErrorHandlingOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-context.ts#L18) |
| `ErrorLogEntry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/logging.ts#L13) |
| `ErrorSlug` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry.ts#L52) |
| `ErrorSolution` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/catalog/types.ts#L3) |
| `LogLevel` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-context.ts#L16) |
| `PartialErrorCatalog` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/catalog/types.ts#L15) |
| `RegisteredError` | Registered error with factory method | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/types.ts#L61) |
| `RetryWithBackoffOptions` | Options for `retryWithBackoff`. Every `attempt` value passed to `fn` and the hooks below is 0-based (first try = 0), including `wrapFinalError`'s `lastAttempt`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-handlers.ts#L53) |
| `RFC9457Response` | RFC 9457 Problem Details response shape | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/types.ts#L20) |
| `UserFriendlyErrorSolution` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/user-friendly/error-catalog.ts#L3) |
| `VeryfrontErrorData` | Discriminated union for serializable error data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/veryfront-error.ts#L69) |
| `VeryfrontErrorOptions` | Options for VeryfrontError constructor | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/types.ts#L91) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/errors/general`

```ts
import { AUTHENTICATION_REQUIRED, FILE_NOT_FOUND, GENERAL_REGISTRY } from "veryfront/errors/general";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `AUTHENTICATION_REQUIRED` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L11) |
| `FILE_NOT_FOUND` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L27) |
| `GENERAL_REGISTRY` | Registry fragment for GENERAL errors (slug → definition). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L111) |
| `INITIALIZATION_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L60) |
| `INPUT_VALIDATION_FAILED` | HTTP request input validation failures (replaces ValidationError) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L86) |
| `INVALID_ARGUMENT` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L43) |
| `NOT_SUPPORTED` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L68) |
| `PERMISSION_DENIED` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L19) |
| `PROJECT_SOURCE_EMPTY` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L94) |
| `RESOURCE_NOT_FOUND` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L35) |
| `SECURITY_VIOLATION` | Path traversal / secure-fs violations (replaces SecurityError) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L77) |
| `TIMEOUT_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L52) |
| `UNKNOWN_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/general.ts#L3) |

### `veryfront/errors/module`

```ts
import { CIRCULAR_DEPENDENCY, DEPENDENCY_MISSING, IMPORT_RESOLUTION_ERROR } from "veryfront/errors/module";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `CIRCULAR_DEPENDENCY` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/module.ts#L19) |
| `DEPENDENCY_MISSING` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/module.ts#L35) |
| `IMPORT_RESOLUTION_ERROR` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/module.ts#L11) |
| `INVALID_IMPORT` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/module.ts#L27) |
| `MODULE_NOT_FOUND` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/module.ts#L3) |
| `MODULE_REGISTRY` | Registry fragment for MODULE errors (slug → definition). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/module.ts#L52) |
| `VERSION_MISMATCH` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/errors/error-registry/module.ts#L43) |
