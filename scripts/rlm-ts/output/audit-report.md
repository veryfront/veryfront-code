# Code Audit Report

Generated: 2026-01-24T17:52:16.297Z

## Summary

The audit found inconsistencies in naming ('err' vs 'error'), imports (relative vs absolute), and types ('any' vs 'unknown'). The dominant patterns are 'error', absolute imports, and 'unknown'.

**Total inconsistencies found: 3**

## Naming

### Inconsistent variable naming: 'err' vs 'error'.

- **Dominant pattern**: error
- **Violations**: 46 instances
- **Fix**: Rename variables from 'err' to 'error' for consistency.

**Files to fix:**
```
src/middleware/builtin/security/redis-rate-limit.ts
src/security/sandbox/deno-sandbox.ts
src/server/handlers/dev/dashboard/ui/components/ErrorsTab.tsx
src/server/handlers/dev/dashboard/api.ts
src/server/handlers/request/ssr/error-page-fallback.ts
src/utils/logger/logger.ts
src/utils/redis-client.ts
src/cli/templates/features/blob/files/app/upload/page.tsx
src/cli/templates/integrations/clickup/files/lib/clickup-client.ts
src/cli/templates/integrations/snowflake/files/lib/snowflake-client.ts
src/cli/templates/integrations/supabase/files/lib/supabase-client.ts
src/cli/templates/integrations/figma/files/lib/figma-client.ts
src/cli/templates/integrations/zendesk/files/app/api/auth/zendesk/callback/route.ts
src/cli/templates/integrations/servicenow/files/app/api/auth/servicenow/callback/route.ts
src/cli/templates/integrations/_base/files/app/components/ServiceConnections.tsx
src/cli/commands/generate/integration-generator.ts
src/rendering/cache/stores/redis-store.ts
src/rendering/ssr-renderer.ts
src/routing/api/error-handler.ts
src/build/renderer/services/script-bundler.ts
... and 3 more files
```

## Imports

### Inconsistent import styles: relative vs absolute imports.

- **Dominant pattern**: absolute imports
- **Violations**: 50 instances
- **Fix**: Convert relative imports to absolute imports for consistency.

**Files to fix:**
```
src/middleware/core/pipeline/pipeline.ts
src/middleware/core/context.ts
src/middleware/builtin/security/csp.ts
src/middleware/builtin/security/cors-simple.ts
src/middleware/builtin/security/security-headers.ts
src/middleware/builtin/security/rate-limit.ts
src/middleware/builtin/security/redis-rate-limit.ts
src/middleware/builtin/logger.ts
src/middleware/builtin/timeout.ts
src/embeddings/index.ts
src/cache/request-cache-batcher.ts
src/cache/distributed-cache-init.ts
src/cache/backend.ts
src/config/schema.ts
src/config/define-config.ts
src/config/loader.ts
src/config/runtime-config.ts
src/config/env.ts
src/security/input-validation/parsers.ts
src/security/input-validation/limits.ts
... and 7 more files
```

## Types

### Inconsistent type usage: 'any' vs 'unknown'.

- **Dominant pattern**: unknown
- **Violations**: 50 instances
- **Fix**: Replace 'any' with 'unknown' for better type safety.

**Files to fix:**
```
src/oauth/providers/base.ts
src/cache/cache-key-builder.ts
src/cache/backend.ts
src/config/types.ts
src/security/http/response/static-helpers.ts
src/platform/compat/path/url-conversion.ts
src/platform/compat/fs.ts
src/platform/compat/std/expect.ts
src/platform/compat/smoke-test.ts
src/platform/compat/react-paths.ts
src/platform/adapters/base.ts
src/platform/adapters/runtime/shared/shared-watcher.ts
src/platform/adapters/runtime/bun/filesystem-adapter.ts
src/platform/adapters/fs/veryfront/multi-project-adapter.ts
src/provider/factory.ts
src/server/handlers/dev/dashboard/ui/App.tsx
src/server/handlers/dev/dashboard/ui/components/MCPTab.tsx
src/server/handlers/request/api/api-handler-wrapper.ts
src/server/handlers/request/rsc/handlers/render-handler.ts
src/utils/route-path-utils.ts
```

## Next Steps

Use batch processing to fix these inconsistencies:
```bash
deno task batch:prepare  # Will use this report to generate fixes
deno task batch:submit
```