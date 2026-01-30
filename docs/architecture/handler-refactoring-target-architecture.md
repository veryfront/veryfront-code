# Handler Refactoring: Target Architecture Specification

**Version**: 1.0
**Date**: 2026-01-30
**Status**: Draft for Review

## Executive Summary

This document defines the target architecture for refactoring the veryfront-renderer handler system. The current structure has 81 handler files with ~8,000 LOC across 22 directories, including anti-patterns like nested `handlers/` directories (5 levels deep) and 630-line monolithic files.

The target architecture enforces:
- **3-level maximum depth** from `src/`
- **Thin handlers** (~50-100 LOC) with extracted services
- **Domain-first organization** with clear boundaries
- **Strangler fig migration** for zero-downtime refactoring

---

## 1. Target Directory Structure

### 1.1 Overview

```
src/server/
├── handlers/                    # Request handlers (thin orchestration layer)
│   ├── index.ts                 # Main exports
│   ├── types.ts                 # Shared types (re-exported from @veryfront/types)
│   │
│   ├── rendering/               # Page rendering (SSR, RSC)
│   │   ├── ssr.handler.ts       # ~100 LOC - SSR orchestration
│   │   ├── rsc.handler.ts       # ~80 LOC - RSC orchestration
│   │   ├── rsc-endpoints.handler.ts  # ~60 LOC - RSC sub-endpoints
│   │   └── index.ts             # Named exports only
│   │
│   ├── modules/                 # Module serving
│   │   ├── module.handler.ts    # ~80 LOC - Module serving
│   │   ├── batch-module.handler.ts  # ~60 LOC
│   │   ├── lib-modules.handler.ts   # ~70 LOC
│   │   └── index.ts
│   │
│   ├── api/                     # API routes
│   │   ├── api-route.handler.ts # ~80 LOC - User API routes
│   │   ├── openapi.handler.ts   # ~60 LOC - OpenAPI docs
│   │   └── index.ts
│   │
│   ├── static/                  # Static assets
│   │   ├── static.handler.ts    # ~80 LOC - Static files
│   │   ├── css.handler.ts       # ~60 LOC - CSS serving
│   │   ├── snippet.handler.ts   # ~60 LOC - Code snippets
│   │   └── index.ts
│   │
│   ├── dev/                     # Development-only handlers
│   │   ├── dashboard.handler.ts # ~50 LOC - Dashboard UI
│   │   ├── dashboard-api.handler.ts  # ~100 LOC - Dashboard API
│   │   ├── debug.handler.ts     # ~40 LOC - Debug endpoints
│   │   ├── hmr.handler.ts       # ~80 LOC - HMR WebSocket
│   │   ├── dev-endpoints.handler.ts  # ~100 LOC - Dev JS scripts
│   │   ├── dev-files.handler.ts # ~60 LOC - File browser
│   │   └── index.ts
│   │
│   ├── preview/                 # Preview mode handlers
│   │   ├── hmr.handler.ts       # ~80 LOC - Preview HMR
│   │   ├── markdown.handler.ts  # ~60 LOC - Markdown preview
│   │   └── index.ts
│   │
│   ├── monitoring/              # Health & metrics
│   │   ├── health.handler.ts    # ~40 LOC
│   │   ├── metrics.handler.ts   # ~40 LOC
│   │   ├── memory.handler.ts    # ~50 LOC
│   │   ├── client-log.handler.ts # ~40 LOC
│   │   └── index.ts
│   │
│   ├── studio/                  # Studio integration
│   │   ├── studio.handler.ts    # ~40 LOC
│   │   └── index.ts
│   │
│   └── response/                # Response utilities
│       ├── base.ts              # BaseHandler re-export
│       ├── cors.ts              # CORS middleware
│       ├── not-found.ts         # 404 handling
│       └── index.ts
│
├── services/                    # Business logic (NEW)
│   ├── rendering/
│   │   ├── ssr.service.ts       # SSR rendering logic
│   │   ├── rsc.service.ts       # RSC rendering logic
│   │   ├── error-page.service.ts  # Error page fallbacks
│   │   ├── etag.service.ts      # ETag computation
│   │   └── index.ts
│   │
│   ├── modules/
│   │   ├── module-transform.service.ts
│   │   ├── module-cache.service.ts
│   │   └── index.ts
│   │
│   ├── dev/
│   │   ├── dashboard-data.service.ts  # Dashboard data aggregation
│   │   ├── file-browser.service.ts    # File browsing logic
│   │   ├── hmr-client.service.ts      # HMR client management
│   │   └── index.ts
│   │
│   └── static/
│       ├── static-file.service.ts
│       └── index.ts
│
├── context/                     # Request context (existing)
├── shared/                      # Shared utilities (existing)
├── universal-handler/           # Universal handler (existing)
├── dev-server/                  # Dev server (existing)
└── utils/                       # Server utilities (existing)
```

### 1.2 Depth Analysis

| Path | Depth from src/ | Status |
|------|-----------------|--------|
| `src/server/handlers/rendering/ssr.handler.ts` | 3 | COMPLIANT |
| `src/server/handlers/dev/dashboard.handler.ts` | 3 | COMPLIANT |
| `src/server/services/rendering/ssr.service.ts` | 3 | COMPLIANT |
| `src/server/handlers/dev/dashboard/ui/components/` | 6 | REMOVED (move to separate package) |

### 1.3 What Gets Removed

The following deep-nested structures will be eliminated:

```
REMOVED:
├── handlers/request/rsc/endpoints/     # 5 levels - flatten
├── handlers/request/rsc/handlers/      # 5 levels - nested "handlers" anti-pattern
├── handlers/dev/dashboard/ui/          # 6 levels - move to separate package
├── handlers/dev/projects/ui/           # 6 levels - move to separate package
```

---

## 2. Naming Conventions

### 2.1 File Naming

| Type | Pattern | Example |
|------|---------|---------|
| Handler | `{domain}.handler.ts` | `ssr.handler.ts` |
| Service | `{domain}.service.ts` | `ssr.service.ts` |
| Test | `{file}.test.ts` | `ssr.handler.test.ts` |
| Index | `index.ts` | `index.ts` |
| Types | `types.ts` | `types.ts` |

**Rationale**: The `.handler.ts` and `.service.ts` suffixes:
- Make file purpose immediately clear
- Enable easy grep/glob filtering
- Match industry conventions (Angular, NestJS)
- Prevent naming conflicts with modules

### 2.2 Class Naming

| Type | Pattern | Example |
|------|---------|---------|
| Handler class | `{Domain}Handler` | `SSRHandler` |
| Service class | `{Domain}Service` | `SSRService` |
| Types | `{Domain}{Type}` | `SSRRenderOptions` |

### 2.3 Export Naming

| Type | Pattern | Example |
|------|---------|---------|
| Handler export | Named, PascalCase | `export { SSRHandler }` |
| Service export | Named, PascalCase | `export { SSRService }` |
| Function export | Named, camelCase | `export { renderPage }` |

**NEVER use barrel wildcards** (`export * from`). Always use explicit named exports.

---

## 3. Service Extraction Boundaries

### 3.1 Extraction Criteria

Extract logic into a service when:

1. **Reused across handlers** - Same logic in 2+ handlers
2. **Complex domain logic** - >50 LOC of non-orchestration code
3. **Testable in isolation** - Pure business logic without HTTP concerns
4. **External dependencies** - API calls, file system, caching

### 3.2 Handler vs Service Responsibilities

| Handler Responsibilities | Service Responsibilities |
|-------------------------|--------------------------|
| Request parsing | Business logic execution |
| Route matching | Data transformation |
| Error response formatting | External API calls |
| Header management | Caching strategy |
| Response building | State management |
| Logging/tracing orchestration | Domain calculations |

### 3.3 Service Extraction Map

| Current Handler | LOC | Extract to Service? | Service Name |
|-----------------|-----|---------------------|--------------|
| `ssr-handler.ts` | 481 | YES | `SSRService` |
| `dev/endpoints.ts` | 630 | YES | Split: `HMRScriptService`, `ErrorOverlayService` |
| `dev/dashboard/api.ts` | 640 | YES | `DashboardDataService` |
| `static.ts` | 336 | YES | `StaticFileService` |
| `hmr-handler.ts` | 307 | YES | `HMRClientService` |
| `markdown-preview-handler.ts` | 289 | YES | `MarkdownPreviewService` |
| `rsc/endpoints/endpoint-router.ts` | 272 | YES | `RSCEndpointService` |
| `error-page-fallback.ts` | 233 | YES | `ErrorPageService` |
| `styles-css-handler.ts` | 216 | YES | Move to `CSSService` |
| `esbuild-plugins.ts` | 203 | NO | Keep as utility module |
| All handlers <150 LOC | <150 | NO | Keep inline |

### 3.4 Service Location

| Service Type | Location | Shared By |
|--------------|----------|-----------|
| Domain-specific | `src/server/services/{domain}/` | Handlers in that domain |
| Cross-domain | `src/server/shared/` | Multiple domains |
| Infrastructure | `src/core/` or `src/platform/` | Entire codebase |

---

## 4. Migration Milestones

### 4.1 Phase 1: Foundation (Week 1-2)

**Goal**: Establish structure without breaking changes.

**Tasks**:
1. Create `src/server/services/` directory structure
2. Create `index.ts` files with explicit exports
3. Add `.handler.ts` suffix to new handlers only (aliases for old)
4. Extract first service: `SSRService` from `ssr-handler.ts`

**Scope**:
- `src/server/services/rendering/ssr.service.ts` (NEW)
- `src/server/handlers/rendering/ssr.handler.ts` (refactored)

**Risk Level**: LOW - New files only, no breaking changes

**Exit Criteria**:
- [ ] All tests pass
- [ ] SSR handler is <100 LOC
- [ ] SSRService is independently testable
- [ ] No import path changes for consumers

### 4.2 Phase 2: Handler Consolidation (Week 3-4)

**Goal**: Flatten nested handlers, add .handler.ts suffix.

**Tasks**:
1. Flatten `handlers/request/rsc/endpoints/` to `handlers/rendering/`
2. Flatten `handlers/request/rsc/handlers/` to services
3. Rename handlers with `.handler.ts` suffix
4. Update all import paths (use find-replace script)

**Scope**:
- `handlers/request/ssr/` -> `handlers/rendering/`
- `handlers/request/rsc/` -> `handlers/rendering/` + services
- `handlers/request/module/` -> `handlers/modules/`
- `handlers/request/api/` -> `handlers/api/`

**Migration Script**:
```bash
# Create aliases for old paths (deprecation period)
# deno task migrate:phase2
```

**Risk Level**: MEDIUM - Import path changes

**Exit Criteria**:
- [ ] Maximum 3 levels from src/ for all handlers
- [ ] All handlers have `.handler.ts` suffix
- [ ] Old import paths still work (deprecation aliases)
- [ ] No nested `handlers/` directories

### 4.3 Phase 3: Dev Tools Extraction (Week 5-6)

**Goal**: Extract dev dashboard UI to separate package, slim down handlers.

**Tasks**:
1. Move `handlers/dev/dashboard/ui/` to `packages/dev-dashboard/`
2. Move `handlers/dev/projects/ui/` to `packages/dev-dashboard/`
3. Create `DashboardDataService` for API logic
4. Slim `DevEndpointsHandler` (currently 630 LOC)

**Scope**:
- `handlers/dev/dashboard/` -> handler + service
- `handlers/dev/projects/` -> handler + service
- UI components -> `packages/dev-dashboard/`

**Risk Level**: MEDIUM - New package boundary

**Exit Criteria**:
- [ ] No UI components in handlers/
- [ ] Dev handlers are <100 LOC each
- [ ] Dashboard package is independently buildable
- [ ] HMR still works

### 4.4 Phase 4: Final Cleanup (Week 7-8)

**Goal**: Remove deprecation aliases, finalize architecture.

**Tasks**:
1. Remove old import path aliases
2. Update all external consumers
3. Final documentation
4. Architecture validation script

**Scope**:
- All remaining handlers
- Documentation updates
- CI validation

**Risk Level**: LOW - Cleanup only

**Exit Criteria**:
- [ ] No deprecation aliases remain
- [ ] Architecture validation passes
- [ ] All handlers <150 LOC
- [ ] All services independently testable

---

## 5. Acceptance Criteria

### 5.1 Structural Metrics

| Metric | Current | Target | Validation |
|--------|---------|--------|------------|
| Max depth from src/ | 6 | 3 | `find -maxdepth 4 -type d \| wc -l` |
| Max handler LOC | 630 | 150 | `wc -l *.handler.ts` |
| Average handler LOC | ~98 | <80 | `wc -l *.handler.ts / count` |
| Nested handlers/ dirs | 2 | 0 | `find -name handlers -type d` |
| Handler file count | 81 | ~40 | Fewer, larger-scoped handlers |

### 5.2 Test Requirements

**Per Phase**:
- [ ] All existing tests pass (zero regressions)
- [ ] New services have unit tests (>80% coverage)
- [ ] Integration tests for handler->service flow

**Final**:
- [ ] E2E tests pass
- [ ] Performance benchmarks unchanged (+/- 5%)
- [ ] Memory usage unchanged (+/- 10%)

### 5.3 Architecture Validation Script

```typescript
// scripts/validate-architecture.ts
import { walk } from "@std/fs/walk";

const RULES = {
  maxDepthFromSrc: 3,
  maxHandlerLOC: 150,
  noNestedHandlers: true,
  namedExportsOnly: true,
};

async function validate() {
  const violations: string[] = [];

  // Check depth
  for await (const entry of walk("src/server/handlers")) {
    const depth = entry.path.split("/").length - 2;
    if (depth > RULES.maxDepthFromSrc) {
      violations.push(`Depth violation: ${entry.path} (${depth} levels)`);
    }
  }

  // Check for nested handlers/
  for await (const entry of walk("src/server/handlers")) {
    if (entry.isDirectory && entry.name === "handlers") {
      violations.push(`Nested handlers/ found: ${entry.path}`);
    }
  }

  // Report
  if (violations.length > 0) {
    console.error("Architecture violations found:");
    violations.forEach(v => console.error(`  - ${v}`));
    Deno.exit(1);
  }

  console.log("Architecture validation passed");
}

validate();
```

### 5.4 CI Integration

```yaml
# .github/workflows/architecture.yml
architecture-validation:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: denoland/setup-deno@v2
    - run: deno run --allow-read scripts/validate-architecture.ts
```

---

## 6. Detailed Handler Mapping

### 6.1 Current -> Target Mapping

| Current Path | Target Path | Action |
|--------------|-------------|--------|
| `request/ssr/ssr-handler.ts` | `rendering/ssr.handler.ts` | MOVE + REFACTOR |
| `request/ssr/etag-handler.ts` | `services/rendering/etag.service.ts` | CONVERT TO SERVICE |
| `request/ssr/not-found-fallback.ts` | `response/not-found.ts` | MERGE |
| `request/ssr/error-page-fallback.ts` | `services/rendering/error-page.service.ts` | CONVERT TO SERVICE |
| `request/ssr/index.ts` | `rendering/index.ts` | MOVE |
| `request/rsc/handlers/handler.ts` | `rendering/rsc.handler.ts` | MOVE + RENAME |
| `request/rsc/handlers/*.ts` | `services/rendering/rsc.service.ts` | MERGE INTO SERVICE |
| `request/rsc/endpoints/endpoint-router.ts` | `rendering/rsc-endpoints.handler.ts` | MOVE + SLIM |
| `request/rsc/endpoints/action-handler.ts` | `services/rendering/rsc-action.service.ts` | CONVERT TO SERVICE |
| `request/rsc/endpoints/script-handlers.ts` | `services/rendering/rsc-scripts.service.ts` | CONVERT TO SERVICE |
| `request/module/*.ts` | `modules/module.handler.ts` | CONSOLIDATE |
| `request/api/*.ts` | `api/api-route.handler.ts` | CONSOLIDATE |
| `request/static.ts` | `static/static.handler.ts` | MOVE |
| `request/css-handler.ts` | `static/css.handler.ts` | MOVE |
| `request/snippet-handler.ts` | `static/snippet.handler.ts` | MOVE |
| `request/lib-modules-handler.ts` | `modules/lib-modules.handler.ts` | MOVE |
| `request/openapi-*.ts` | `api/openapi.handler.ts` | CONSOLIDATE |
| `dev/endpoints.ts` | `dev/dev-endpoints.handler.ts` + services | SPLIT |
| `dev/dashboard/api.ts` | `dev/dashboard-api.handler.ts` + service | SPLIT |
| `dev/dashboard/ui-handler.ts` | `dev/dashboard.handler.ts` | MOVE |
| `dev/dashboard/ui/*` | `packages/dev-dashboard/` | EXTRACT TO PACKAGE |
| `dev/projects/*` | `dev/projects.handler.ts` + service | CONSOLIDATE |
| `dev/files/*.ts` | `services/dev/file-browser.service.ts` | CONVERT TO SERVICE |
| `dev/styles-css-handler.ts` | `services/dev/css-dev.service.ts` | CONVERT TO SERVICE |
| `preview/hmr-handler.ts` | `preview/hmr.handler.ts` | RENAME |
| `preview/markdown-preview-handler.ts` | `preview/markdown.handler.ts` | RENAME |
| `monitoring/*.ts` | `monitoring/*.handler.ts` | RENAME |
| `studio/*.ts` | `studio/studio.handler.ts` | CONSOLIDATE |
| `response/*.ts` | `response/*.ts` | KEEP |
| `security/*.ts` | `response/*.ts` | MERGE |
| `utils/*.ts` | KEEP or move to services | EVALUATE |

### 6.2 New Service Files

| Service Path | Extracted From | LOC (est) |
|--------------|----------------|-----------|
| `services/rendering/ssr.service.ts` | `ssr-handler.ts` | ~300 |
| `services/rendering/rsc.service.ts` | `rsc/handlers/*.ts` | ~200 |
| `services/rendering/error-page.service.ts` | `error-page-fallback.ts` | ~150 |
| `services/rendering/etag.service.ts` | `etag-handler.ts` | ~50 |
| `services/dev/dashboard-data.service.ts` | `dashboard/api.ts` | ~400 |
| `services/dev/file-browser.service.ts` | `dev/files/*.ts` | ~200 |
| `services/dev/hmr-script.service.ts` | `dev/endpoints.ts` | ~300 |
| `services/static/static-file.service.ts` | `static.ts` | ~200 |

---

## 7. Example Refactoring: SSRHandler

### 7.1 Before (481 LOC)

```typescript
// Current: src/server/handlers/request/ssr/ssr-handler.ts
export class SSRHandler extends BaseHandler {
  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    // 400+ lines of mixed orchestration and business logic
    // - Route parsing
    // - Memory checks
    // - Context setup
    // - Renderer initialization
    // - Page rendering
    // - Error handling
    // - Response building
  }
}
```

### 7.2 After (~80 LOC handler + ~300 LOC service)

```typescript
// Target: src/server/handlers/rendering/ssr.handler.ts
import { SSRService } from "../../services/rendering/ssr.service.ts";

export class SSRHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "SSRHandler",
    priority: PRIORITY_LOW,
    patterns: [{ pattern: /^(?!\/_).*/, method: ["GET", "HEAD"] }],
  };

  private service = new SSRService();

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);

    // Quick route checks
    if (this.shouldSkip(url.pathname)) {
      return this.continue();
    }

    try {
      // Delegate to service
      const result = await this.service.render(req, ctx, url);

      return this.respond(
        this.createResponseBuilder(ctx, result.nonce)
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig)
          .withCache(result.cacheStrategy)
          .withETag(result.etag)
          .withContentType("text/html", result.body, result.status)
      );
    } catch (error) {
      return this.handleError(error, req, ctx);
    }
  }

  private shouldSkip(pathname: string): boolean {
    if (pathname.startsWith("/_veryfront/")) return true;
    if (/\.[a-zA-Z0-9]+$/.test(pathname)) return true;
    return false;
  }

  private async handleError(error: Error, req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const errorResult = await this.service.handleError(error, req, ctx);
    return this.respond(
      this.createResponseBuilder(ctx, errorResult.nonce)
        .withCache("no-cache")
        .withContentType("text/html", errorResult.body, errorResult.status)
    );
  }
}
```

```typescript
// Target: src/server/services/rendering/ssr.service.ts
export class SSRService {
  async render(
    req: Request,
    ctx: HandlerContext,
    url: URL
  ): Promise<SSRRenderResult> {
    // All the complex rendering logic
    // Memory checks, renderer init, page rendering, etc.
  }

  async handleError(
    error: Error,
    req: Request,
    ctx: HandlerContext
  ): Promise<SSRErrorResult> {
    // Error page rendering logic
  }
}
```

---

## 8. Open Questions

1. **UI Components Package**: Should `packages/dev-dashboard/` be a separate repo or monorepo package?
   - Recommendation: Monorepo package for easier iteration

2. **Shared Services**: Where do truly cross-cutting services live?
   - Recommendation: `src/server/shared/services/` for server-only, `src/core/` for universal

3. **Backward Compatibility Period**: How long to maintain old import aliases?
   - Recommendation: 2 releases (8 weeks)

4. **Test Migration**: Move tests with handlers or keep flat in `/tests`?
   - Recommendation: Colocate `*.handler.test.ts` with handlers for unit tests, keep integration tests in `/tests`

---

## 9. Appendix: Handler Inventory

### Current Handler Files (81 total)

```
handlers/
├── index.ts
├── types.ts
├── dev/
│   ├── index.ts
│   ├── endpoints.ts (630 LOC) *
│   ├── debug-context.ts
│   ├── styles-css-handler.ts (216 LOC) *
│   ├── dashboard/
│   │   ├── index.ts
│   │   ├── api.ts (640 LOC) *
│   │   ├── html-shell.ts
│   │   ├── ui-handler.ts
│   │   └── ui/ (multiple components)
│   ├── files/
│   │   ├── index.ts
│   │   ├── dev-file-handler.ts
│   │   ├── esbuild-bundler.ts
│   │   ├── esbuild-plugins.ts (203 LOC) *
│   │   └── path-validator.ts
│   └── projects/
│       ├── index.ts
│       ├── api.ts
│       ├── html-shell.ts
│       ├── ui-handler.ts
│       └── ui/ (multiple components)
├── monitoring/
│   ├── index.ts
│   ├── health.ts
│   ├── memory.ts (166 LOC)
│   ├── metrics.ts
│   └── client-log.ts
├── preview/
│   ├── hmr-handler.ts (307 LOC) *
│   └── markdown-preview-handler.ts (289 LOC) *
├── request/
│   ├── index.ts
│   ├── static.ts (336 LOC) *
│   ├── css-handler.ts
│   ├── snippet-handler.ts (132 LOC)
│   ├── lib-modules-handler.ts (129 LOC)
│   ├── openapi-handler.ts (133 LOC)
│   ├── openapi-docs-handler.ts
│   ├── api/
│   │   ├── index.ts
│   │   ├── app-router-handler.ts
│   │   ├── app-router-resolver.ts
│   │   ├── api-handler-wrapper.ts (190 LOC)
│   │   ├── pages-api-handler.ts
│   │   ├── security-headers.ts
│   │   └── types.ts
│   ├── module/
│   │   ├── index.ts
│   │   ├── module-handler.ts (124 LOC)
│   │   ├── module-server-handler.ts
│   │   ├── batch-module-handler.ts
│   │   ├── page-module-handler.ts
│   │   ├── page-data-endpoint-handler.ts
│   │   ├── data-endpoint-handler.ts
│   │   └── virtual-module-handler.ts
│   ├── rsc/
│   │   ├── index.ts
│   │   ├── endpoints/
│   │   │   ├── index.ts
│   │   │   ├── endpoint-router.ts (272 LOC) *
│   │   │   ├── action-handler.ts
│   │   │   ├── action-parser.ts
│   │   │   ├── handler-registry.ts
│   │   │   ├── script-handlers.ts
│   │   │   └── types.ts
│   │   └── handlers/
│   │       ├── index.ts
│   │       ├── handler.ts
│   │       ├── page-handler.ts
│   │       ├── render-handler.ts (145 LOC)
│   │       ├── stream-handler.ts
│   │       ├── manifest-handler.ts
│   │       ├── hydrator-handler.ts
│   │       ├── component-resolver.ts
│   │       ├── environment.ts
│   │       └── types.ts
│   └── ssr/
│       ├── index.ts
│       ├── ssr-handler.ts (481 LOC) *
│       ├── etag-handler.ts
│       ├── not-found-fallback.ts
│       └── error-page-fallback.ts (233 LOC) *
├── response/
│   ├── index.ts
│   ├── base.ts
│   ├── cors.ts (146 LOC)
│   └── not-found.ts (154 LOC)
├── security/
│   └── index.ts
├── studio/
│   ├── index.ts
│   └── endpoints.ts
└── utils/
    ├── index.ts
    ├── content-types.ts
    └── etag.ts

* = High-priority for refactoring (>150 LOC)
```

---

## 10. Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-30 | AI Assistant | Initial draft |
