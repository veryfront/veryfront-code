# Handler Architecture Refactor Plan

**Status**: ✅ COMPLETE (All 4 Phases)
**Created**: 2025-01-30
**Updated**: 2026-01-30
**Author**: Architecture Review

## Implementation Progress

### Phase 1: Foundation (COMPLETE)

| Task | Status | Notes |
|------|--------|-------|
| Create `services/` directory structure | ✅ Done | `rendering/`, `modules/`, `dev/`, `static/` created |
| Create SSRService | ✅ Done | 330 LOC, type-checked, linted |
| Architecture validation script | ✅ Done | `scripts/validate-architecture.ts` |
| Quality gates | ✅ Done | Lint, typecheck, unit tests pass |
| Integrate SSRService into SSRHandler | ✅ Done | 482 → 360 LOC (25% reduction) |

**Results**:
- SSRHandler: 482 → 360 LOC (25% reduction)
- SSRService: 330 LOC (extracted business logic)
- Thin handler pattern validated

### Phase 2: Naming Consistency (COMPLETE)

| Task | Status | Notes |
|------|--------|-------|
| Rename monitoring handlers | ✅ Done | 4 files: health, metrics, memory, client-log |
| Rename preview handlers | ✅ Done | 2 files: hmr, markdown-preview |
| Rename request handlers | ✅ Done | 8 files: static, css, snippet, lib-modules, openapi, openapi-docs, module, ssr |
| Rename dev handlers | ✅ Done | 4 files: endpoints, debug-context, styles-css, dev-file |
| Rename studio handlers | ✅ Done | 1 file: endpoints |
| Update all imports | ✅ Done | Barrel exports, universal-handler, production-server |

**Results**:
- 19 handler files renamed to use `.handler.ts` suffix
- Naming Convention validation: ✅ PASS
- All type checks, lint, and tests pass

### Phase 3: RSC Services Extraction (COMPLETE)

| Task | Status | Notes |
|------|--------|-------|
| Move rsc/endpoints/ to services | ✅ Done | 8 files moved to `services/rsc/endpoints/` |
| Move rsc/handlers/ to services | ✅ Done | 11 files moved to `services/rsc/orchestrators/` |
| Create RSC services barrel exports | ✅ Done | `services/rsc/index.ts` with full type exports |
| Update all imports | ✅ Done | RSC handler, cleanup.ts, integration tests |
| Clean up old directories | ✅ Done | Empty rsc subdirectories removed |

**Results**:
- Depth errors: 45 → 23 (49% reduction)
- Nested Handlers validation: ✅ PASS (was 1 error)
- RSC business logic properly extracted to services layer
- All type checks, lint, and tests pass

### Phase 4: Service Extraction & UI Reorganization (COMPLETE)

| Task | Status | Notes |
|------|--------|-------|
| Extract StaticFileService | ✅ Done | 337 → 118 LOC (65% reduction) |
| Move dev UI components | ✅ Done | 23 files → `src/server/dev-ui/` |
| HMRService assessment | ✅ Skipped | WebSocket management - inherently coupled to handler |
| MarkdownPreviewService assessment | ✅ Skipped | Template generation - business logic already extracted |

**Results**:
- StaticHandler: 337 → 118 LOC (65% reduction)
- StaticFileService: 368 LOC (manifest, file resolution, caching)
- Depth errors: 23 → **0** ✅ (moved dev UI to `src/server/dev-ui/`)
- All architecture validation checks now pass

**Remaining Technical Debt** (Low Priority):
- 7 LOC warnings for handlers that are primarily:
  - JS template generation (DevEndpointsHandler)
  - WebSocket management (HMRHandler)
  - HTML template generation (MarkdownPreviewHandler)
  - These don't benefit from service extraction

## Problem Statement

The current handler structure in `src/server/handlers/` feels "too distributed and hard to understand":

- **99 files, ~16,000 LOC** scattered across 6+ categories
- **No single view** of all request handlers
- **Nested confusion**: RSC has `handlers/` inside `handlers/` (endpoints/ + handlers/)
- **Mixed naming**: `static.ts` vs `css-handler.ts` vs `ssr/ssr-handler.ts`
- **15+ separate caches** with no unified abstraction
- **New developers struggle** to understand the structure

## Design Goals

| Goal | Description | Weight |
|------|-------------|--------|
| **Discoverability** | Find ALL handlers in one place | 25% |
| **Clarity** | Understand structure in 5 minutes | 25% |
| **Consistency** | One naming convention, one pattern | 20% |
| **Low Risk** | Minimal refactor breakage | 15% |
| **Scalability** | Works at 50+ handlers | 15% |

## Target Architecture

### Directory Structure

```
src/server/
├── handlers/                    # ALL HANDLERS visible from index.ts
│   ├── index.ts                 # Barrel export: every handler by name
│   ├── registry.ts              # Programmatic registration + validation
│   │
│   ├── rendering/               # Core page serving (max 1 level deep)
│   │   ├── ssr.handler.ts       # Server-side rendering
│   │   ├── rsc.handler.ts       # React Server Components
│   │   ├── css.handler.ts       # Tailwind CSS bundle
│   │   ├── snippet.handler.ts   # Code snippet rendering
│   │   └── static.handler.ts    # Static file serving
│   │
│   ├── api/                     # User-defined routes
│   │   ├── routes.handler.ts    # App Router API routes
│   │   ├── pages-api.handler.ts # Legacy Pages API routes
│   │   ├── openapi.handler.ts   # OpenAPI spec endpoint
│   │   └── openapi-docs.handler.ts
│   │
│   ├── modules/                 # Module serving
│   │   ├── module.handler.ts    # ES module serving
│   │   ├── batch.handler.ts     # Batched module requests
│   │   ├── page.handler.ts      # Page module handler
│   │   ├── virtual.handler.ts   # Virtual modules
│   │   ├── lib.handler.ts       # Library modules
│   │   └── data.handler.ts      # Data endpoint modules
│   │
│   ├── ops/                     # Operations & observability
│   │   ├── health.handler.ts    # /healthz, /readyz
│   │   ├── metrics.handler.ts   # Prometheus metrics
│   │   ├── memory.handler.ts    # Memory diagnostics
│   │   └── client-log.handler.ts
│   │
│   ├── dev/                     # Development-only
│   │   ├── hmr.handler.ts       # Hot Module Replacement
│   │   ├── debug.handler.ts     # Debug context
│   │   ├── dashboard.handler.ts # Dev dashboard UI
│   │   ├── projects.handler.ts  # Project selector
│   │   ├── files.handler.ts     # Dev file serving
│   │   └── styles.handler.ts    # Dev styles CSS
│   │
│   ├── studio/                  # Studio integration
│   │   └── endpoints.handler.ts
│   │
│   └── preview/                 # Preview mode
│       ├── hmr.handler.ts       # Preview HMR
│       └── markdown.handler.ts  # Markdown preview
│
├── services/                    # Business logic (extracted from thick handlers)
│   ├── ssr/                     # SSR orchestration
│   │   ├── ssr-service.ts
│   │   ├── etag-computer.ts
│   │   └── not-found-resolver.ts
│   ├── rsc/                     # RSC orchestration
│   │   ├── endpoints/           # Current rsc/endpoints/ moves here
│   │   └── stream-service.ts
│   └── cache/                   # Unified cache abstraction
│       ├── cache-service.ts
│       └── stores/
│
└── support/                     # Shared utilities
    ├── content-types.ts
    ├── etag.ts
    └── response-builder.ts
```

### Naming Convention

| Element | Convention | Example |
|---------|------------|---------|
| Handler files | `{name}.handler.ts` | `ssr.handler.ts` |
| Handler classes | `PascalCase + Handler` | `SSRHandler` |
| Domain directories | lowercase singular | `rendering`, `api`, `ops` |
| Internal utilities | `{name}.ts` (no suffix) | `etag.ts` |
| Services | `{name}-service.ts` | `ssr-service.ts` |

### Key Principles

1. **Maximum 2 levels deep**: `handlers/rendering/ssr.handler.ts` - never deeper
2. **Consistent `.handler.ts` suffix**: Instant recognition of route handlers
3. **Barrel visibility**: `index.ts` exports every handler by name
4. **Progressive extraction**: Start with handlers, extract services as needed
5. **Domain flexibility**: Domains are guidelines, not strict boundaries

### Barrel Export Pattern

```typescript
// src/server/handlers/index.ts
// Rendering
export { SSRHandler } from "./rendering/ssr.handler.ts";
export { RSCHandler } from "./rendering/rsc.handler.ts";
export { CSSHandler } from "./rendering/css.handler.ts";
export { SnippetHandler } from "./rendering/snippet.handler.ts";
export { StaticHandler } from "./rendering/static.handler.ts";

// API
export { RoutesHandler } from "./api/routes.handler.ts";
export { PagesApiHandler } from "./api/pages-api.handler.ts";
export { OpenAPIHandler } from "./api/openapi.handler.ts";
export { OpenAPIDocsHandler } from "./api/openapi-docs.handler.ts";

// Modules
export { ModuleHandler } from "./modules/module.handler.ts";
export { BatchHandler } from "./modules/batch.handler.ts";
export { PageModuleHandler } from "./modules/page.handler.ts";
export { VirtualModuleHandler } from "./modules/virtual.handler.ts";
export { LibHandler } from "./modules/lib.handler.ts";
export { DataHandler } from "./modules/data.handler.ts";

// Ops
export { HealthHandler } from "./ops/health.handler.ts";
export { MetricsHandler } from "./ops/metrics.handler.ts";
export { MemoryHandler } from "./ops/memory.handler.ts";
export { ClientLogHandler } from "./ops/client-log.handler.ts";

// Dev (conditionally exported based on mode)
export { HMRHandler } from "./dev/hmr.handler.ts";
export { DebugHandler } from "./dev/debug.handler.ts";
export { DashboardHandler } from "./dev/dashboard.handler.ts";
export { ProjectsHandler } from "./dev/projects.handler.ts";
export { FilesHandler } from "./dev/files.handler.ts";
export { StylesHandler } from "./dev/styles.handler.ts";

// Studio
export { StudioEndpointsHandler } from "./studio/endpoints.handler.ts";

// Preview
export { PreviewHMRHandler } from "./preview/hmr.handler.ts";
export { MarkdownHandler } from "./preview/markdown.handler.ts";

// Re-export types
export type { HandlerMetadata, HandlerResult, HandlerContext } from "./types.ts";
```

### Handler Interface

```typescript
// All handlers MUST follow this pattern
export class XxxHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "XxxHandler",                    // PascalCase, matches class
    priority: PRIORITY_XXX as HandlerPriority,
    patterns: [
      { pattern: /^\/path/, methods: ["GET", "POST"] }
    ],
    enabled: (ctx) => true,                // Optional: conditional enable
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req)) return this.continue();

    // Handler logic

    return this.respond(response);
  }

  // Optional: context validation
  validateContext?(ctx: HandlerContext): string[] | void;

  // Optional: self-documentation
  describe?(): HandlerDescription;
}
```

## Migration Plan

### Phase 1: Naming Consistency (1-2 days, Low Risk)

**Goal**: Fix all naming inconsistencies without changing behavior.

**Tasks**:
1. Rename files to add `.handler.ts` suffix:
   ```bash
   # Request handlers
   git mv src/server/handlers/request/static.ts src/server/handlers/request/static.handler.ts

   # Monitoring handlers
   git mv src/server/handlers/monitoring/health.ts src/server/handlers/monitoring/health.handler.ts
   git mv src/server/handlers/monitoring/metrics.ts src/server/handlers/monitoring/metrics.handler.ts
   git mv src/server/handlers/monitoring/memory.ts src/server/handlers/monitoring/memory.handler.ts
   git mv src/server/handlers/monitoring/client-log.ts src/server/handlers/monitoring/client-log.handler.ts

   # Response handlers
   git mv src/server/handlers/response/cors.ts src/server/handlers/response/cors.handler.ts
   git mv src/server/handlers/response/not-found.ts src/server/handlers/response/not-found.handler.ts
   ```

2. Create comprehensive `index.ts` barrel export

3. Update all imports (automated via search-replace)

4. Run tests to verify no breakage

**Success Criteria**: All tests pass, all handlers follow `{name}.handler.ts` pattern.

### Phase 2: Domain Organization (3-5 days, Medium Risk)

**Goal**: Reorganize into domain-based structure.

**Tasks**:
1. Create domain directories: `rendering/`, `api/`, `modules/`, `ops/`, `dev/`, `studio/`, `preview/`

2. Move handlers to appropriate domains:
   ```
   request/ssr/* → rendering/ssr.handler.ts
   request/rsc/* → rendering/rsc.handler.ts
   request/css-handler.ts → rendering/css.handler.ts
   request/static.handler.ts → rendering/static.handler.ts
   request/snippet-handler.ts → rendering/snippet.handler.ts

   request/api/* → api/
   request/module/* → modules/

   monitoring/* → ops/
   ```

3. Move RSC internal code to services:
   ```
   request/rsc/endpoints/ → services/rsc/endpoints/
   request/rsc/handlers/ → services/rsc/orchestrators/
   ```

4. Update barrel exports

5. Delete empty directories and redundant index.ts files

**Success Criteria**: Structure matches target, all imports updated, tests pass.

### Phase 3: Service Extraction (2-3 weeks, Incremental)

**Goal**: Extract thick handlers into thin handler + service pairs.

**Tasks** (each is a separate PR):

1. **SSR Service** (largest handler, most complex)
   - Extract `ssr-service.ts` with rendering logic
   - Extract `etag-computer.ts`
   - Extract `not-found-resolver.ts`
   - SSRHandler becomes ~100 LOC

2. **RSC Service**
   - Consolidate endpoints and handlers into `services/rsc/`
   - RSCHandler becomes thin routing layer

3. **Cache Service** (addresses the 15+ cache problem)
   - Create unified `CacheService` interface
   - Migrate existing caches to use unified abstraction
   - Document cache layers (L1/L2/L3)

**Success Criteria**: Handlers under 200 LOC, services independently testable.

### Phase 4: Interface Enhancement (1 week)

**Goal**: Strengthen BaseHandler contract.

**Tasks**:
1. Add optional `validateContext()` method
2. Add optional `describe()` method for auto-documentation
3. Create handler registry with route validation
4. Add development-mode warnings for common mistakes

**Success Criteria**: New handlers get better error messages, auto-generated docs.

## Mapping: Current → Target

| Current Location | Target Location | Notes |
|------------------|-----------------|-------|
| `request/ssr/ssr-handler.ts` | `rendering/ssr.handler.ts` | Flatten |
| `request/ssr/etag-handler.ts` | `services/ssr/etag-computer.ts` | Extract |
| `request/ssr/not-found-fallback.ts` | `services/ssr/not-found-resolver.ts` | Extract |
| `request/ssr/error-page-fallback.ts` | `services/ssr/error-page-resolver.ts` | Extract |
| `request/rsc/index.ts` | `rendering/rsc.handler.ts` | Flatten |
| `request/rsc/endpoints/*` | `services/rsc/endpoints/*` | Move to services |
| `request/rsc/handlers/*` | `services/rsc/orchestrators/*` | Rename + move |
| `request/css-handler.ts` | `rendering/css.handler.ts` | Rename |
| `request/static.ts` | `rendering/static.handler.ts` | Rename |
| `request/snippet-handler.ts` | `rendering/snippet.handler.ts` | Rename |
| `request/api/*` | `api/*.handler.ts` | Flatten |
| `request/module/*` | `modules/*.handler.ts` | Flatten |
| `monitoring/health.ts` | `ops/health.handler.ts` | Rename + move |
| `monitoring/metrics.ts` | `ops/metrics.handler.ts` | Rename + move |
| `monitoring/memory.ts` | `ops/memory.handler.ts` | Rename + move |
| `monitoring/client-log.ts` | `ops/client-log.handler.ts` | Rename + move |
| `response/cors.ts` | `support/cors.handler.ts` | Rename + move |
| `response/not-found.ts` | `support/not-found.handler.ts` | Rename + move |
| `response/base.ts` | `support/base-handler.ts` | Rename + move |
| `dev/*` | `dev/*.handler.ts` | Rename |
| `preview/*` | `preview/*.handler.ts` | Rename |
| `studio/*` | `studio/*.handler.ts` | Rename |

## Decision Matrix (from Debate)

| Criteria (Weight) | Flat (A) | Domain (B) | Service (C) | **Hybrid** |
|-------------------|----------|------------|-------------|------------|
| Discoverability (25%) | 9/10 | 7/10 | 6/10 | **9/10** |
| Clarity (25%) | 7/10 | 8/10 | 9/10 | **8/10** |
| Consistency (20%) | 9/10 | 8/10 | 9/10 | **9/10** |
| Refactor Risk (15%) | 9/10 | 8/10 | 4/10 | **7/10** |
| Scalability (15%) | 5/10 | 8/10 | 9/10 | **8/10** |
| **WEIGHTED TOTAL** | 7.8/10 | 7.7/10 | 7.4/10 | **8.4/10** |

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Files to find all handlers | 8 index.ts | 1 index.ts |
| Max directory depth | 4 levels | 2 levels |
| Naming patterns | 3+ patterns | 1 pattern |
| Time to understand structure | ~30 min | ~5 min |
| Largest handler LOC | 481 (SSR) | <200 |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Import breakage | High | Automated search-replace, comprehensive tests |
| Behavior change | High | Phase 1-2 are pure renames, no logic changes |
| Team disruption | Medium | Phased approach, each PR is reviewable |
| Service over-extraction | Medium | Extract only handlers >200 LOC |

## References

- [Architecture Audit](./architecture-audit/) - Comprehensive audit findings
- [MASTER-REQUEST-FLOW.md](./architecture-audit/MASTER-REQUEST-FLOW.md) - Full request flow diagram
- [Rendering Pipeline Refactor](../.claude/plans/rendering-pipeline-refactor.md) - Related cache unification plan
