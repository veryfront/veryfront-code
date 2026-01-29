# Request Pipeline Architecture

```text
  ┌─────────────────────────────────────────────────────────────────────────────────────────┐
  │                              VERYFRONT RENDERER REQUEST PIPELINE                        │
  └─────────────────────────────────────────────────────────────────────────────────────────┘

                                      HTTP Request
                                           │
                                           ▼
  ┌─────────────────────────────────────────────────────────────────────────────────────────┐
  │  LAYER 1: PROXY (proxy/main.ts)                                                         │
  │  ════════════════════════════════════════════════════════════════════════════════════   │
  │                                                                                         │
  │   Request ──┬──▶ WebSocket? ──▶ handleWebSocketUpgrade() ──▶ HMR Server                 │
  │             │                                                                           │
  │             ├──▶ /_proxy/* ──▶ Health/Stats endpoints                                   │
  │             │                                                                           │
  │             └──▶ Other ──▶ processRequest()                                             │
  │                              │                                                          │
  │                              ├─ Parse domain → extract project slug                     │
  │                              ├─ Fetch OAuth token (with cache)                          │
  │                              ├─ Compute contentSourceId                                 │
  │                              └─ Inject headers: x-token, x-project-slug, x-environment  │
  │                                         │                                               │
  │                                         ▼                                               │
  │                              Forward to Renderer (90s timeout)                          │
  └─────────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ▼
  ┌─────────────────────────────────────────────────────────────────────────────────────────┐
  │  LAYER 2: UNIVERSAL HANDLER (src/server/universal-handler/)                             │
  │  ════════════════════════════════════════════════════════════════════════════════════   │
  │                                                                                         │
  │   ┌─────────────────┐    ┌──────────────────────────────────────────────────────────┐   │
  │   │ Context Builder │    │  Handler Router                                          │   │
  │   │                 │    │  ═══════════════                                         │   │
  │   │ • projectSlug   │    │                                                          │   │
  │   │ • projectId     │───▶│  /_healthz        → Health endpoint                      │   │
  │   │ • environment   │    │  /_vf_modules/*   → Module handler (skip concurrency)    │   │
  │   │ • adapter       │    │  /_lib_modules/*  → Library modules                      │   │
  │   │ • config        │    │  /_vf/css/*       → CSS handler                          │   │
  │   └─────────────────┘    │  ?rsc             → RSC handler                          │   │
  │                          │  /api/*           → API handler                          │   │
  │   ┌─────────────────┐    │  /.* (production) → 403 Forbidden                        │   │
  │   │ Memory Check    │    │  GET/HEAD (page)  → SSR Handler ────────────────────┐    │   │
  │   │ >90% → 503      │    └──────────────────────────────────────────────────────│────┘  │
  │   └─────────────────┘                                                          │        │
  └────────────────────────────────────────────────────────────────────────────────│────────┘
                                                                                   │
                                                                                   ▼
  ┌─────────────────────────────────────────────────────────────────────────────────────────┐
  │  LAYER 3: SSR HANDLER (src/server/handlers/request/ssr/)                                │
  │  ════════════════════════════════════════════════════════════════════════════════════   │
  │                                                                                         │
  │   ┌─────────────────────────────────────────────────────────────────────────────────┐   │
  │   │                          CONCURRENCY GATES                                       │  │
  │   │  ┌─────────────────────────┐    ┌─────────────────────────────────────────────┐ │   │
  │   │  │ Per-Project Limiter     │    │ Global Semaphore                            │ │   │
  │   │  │ (10 concurrent/project) │───▶│ (30 concurrent/pod)                         │ │   │
  │   │  │                         │    │                                             │ │   │
  │   │  │ ❌ Limit reached → 503   │    │ ❌ 5s timeout → 503                          │ │   │
  │   │  │ ✅ Slot acquired         │    │ ✅ Permit acquired                           │ │   │
  │   │  └─────────────────────────┘    └─────────────────────────────────────────────┘ │   │
  │   └─────────────────────────────────────────────────────────────────────────────────┘   │
  │                                         │                                               │
  │                                         ▼                                               │
  │                              Renderer.renderPage(slug, ctx)                             │
  └─────────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ▼
  ┌─────────────────────────────────────────────────────────────────────────────────────────┐
  │  LAYER 4: RENDERER (src/rendering/renderer.ts)                                          │
  │  ════════════════════════════════════════════════════════════════════════════════════   │
  │                                                                                         │
  │   ┌─────────────────────────────────────────────────────────────────────────────────┐   │
  │   │                           RENDER CACHE CHECK                                     │  │
  │   │                                                                                  │  │
  │   │   Key: {projectId}:{environment}:{releaseId}:{slug}:{colorScheme}               │   │
  │   │                                                                                  │  │
  │   │   ┌─────────┐     ┌─────────────────────────────────────────────────────────┐   │   │
  │   │   │ Cache   │ YES │                    CACHE HIT                             │   │  │
  │   │   │ Hit?    │────▶│ Return cached RenderResult immediately (~1ms)            │   │  │──▶
  │   │   │         │     └─────────────────────────────────────────────────────────┘   │   │
  │   │   └────┬────┘                                                                    │  │
  │   │        │ NO                                                                      │  │
  │   │        ▼                                                                         │  │
  │   │   Continue to Pipeline (60s master timeout)                                     │   │
  │   └─────────────────────────────────────────────────────────────────────────────────┘   │
  └─────────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ▼
  ┌─────────────────────────────────────────────────────────────────────────────────────────┐
  │  LAYER 5: 10-STAGE RENDER PIPELINE (src/rendering/orchestrator/pipeline.ts)             │
  │  ════════════════════════════════════════════════════════════════════════════════════   │
  │                                                                                         │
  │  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
  │  │ STAGE 1: Page Resolution                                                           │ │
  │  │ ─────────────────────────                                                          │ │
  │  │ pageResolver.resolvePage(slug)                                                     │ │
  │  │ • Find file in /pages/ or /app/                                                    │ │
  │  │ • Extract frontmatter, path, type                                                  │ │
  │  │ ❌ Not found → 404                                                                 │  │
  │  └────────────────────────────────────────────────────────────────────────────────────┘ │
  │                                         │                                               │
  │  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
  │  │ STAGE 2-3: Layout Collection + Preload (parallel)                                  │ │
  │  │ ─────────────────────────────────────────────────                                  │ │
  │  │ layoutOrchestrator.collectLayouts()        ──┐                                     │ │
  │  │ • Find _layout.tsx in parent dirs           ├── Run in parallel                   │  │
  │  │ layoutOrchestrator.preloadLayoutModules() ──┘                                      │ │
  │  └────────────────────────────────────────────────────────────────────────────────────┘ │
  │                                         │                                               │
  │  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
  │  │ STAGE 4: Route Params                                                              │ │
  │  │ ────────────────────────                                                           │ │
  │  │ extractRouteParams() → Parse [id], [...slug] from path                             │ │
  │  └────────────────────────────────────────────────────────────────────────────────────┘ │
  │                                         │                                               │
  │  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
  │  │ STAGE 5: Two-Phase Data Fetching                                        ⏱️ 10s+15s │ │
  │  │ ──────────────────────────────────                                                 │ │
  │  │                                                                                    │ │
  │  │  Phase 1: Load Modules (10s)           Phase 2: Fetch Data (15s)                   │ │
  │  │  ┌─────────────────────────────┐       ┌─────────────────────────────┐             │ │
  │  │  │ loadModulesInParallel()     │       │ dataFetcher.fetchData()     │             │ │
  │  │  │ • Transform @/ imports      │──────▶│ • getServerData()           │             │ │
  │  │  │ • Validate HTTP bundles     │       │ • getStaticData()           │             │ │
  │  │  │ ❌ Page fail → throw         │       │ ❌ notFound → 404            │             │ │
  │  │  │ ⚠️ Layout fail → continue   │       │ ❌ redirect → 307            │             │ │
  │  │  └─────────────────────────────┘       └─────────────────────────────┘             │ │
  │  └────────────────────────────────────────────────────────────────────────────────────┘ │
  │                                         │                                               │
  │  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
  │  │ STAGE 6-8: Bundle Prep + Layout Apply                                              │ │
  │  │ ────────────────────────────────────                                               │ │
  │  │ pageRenderer.preparePageBundles() → Compile MDX/TSX to React element               │ │
  │  │ layoutOrchestrator.applyLayoutsAndWrappers() → Wrap with layouts                   │ │
  │  └────────────────────────────────────────────────────────────────────────────────────┘ │
  │                                         │                                               │
  │  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
  │  │ STAGE 9: SSR Rendering                                                   ⏱️ 20s   │  │
  │  │ ────────────────────────                                                           │ │
  │  │ ssrOrchestrator.performSSRRendering()                                              │ │
  │  │ • Validate React element                                                           │ │
  │  │ • renderToString() or renderToPipeableStream()                                     │ │
  │  │ • Collect head metadata                                                            │ │
  │  │ • Generate Tailwind CSS (5s timeout)                                               │ │
  │  └────────────────────────────────────────────────────────────────────────────────────┘ │
  │                                         │                                               │
  │  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
  │  │ STAGE 10: Result Assembly                                                          │ │
  │  │ ─────────────────────────                                                          │ │
  │  │ RenderResult { html, stream, frontmatter, headings, ssrHash }                      │ │
  │  │ → Persist to cache (async)                                                         │ │
  │  └────────────────────────────────────────────────────────────────────────────────────┘ │
  └─────────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ▼
  ┌─────────────────────────────────────────────────────────────────────────────────────────┐
  │  LAYER 6: RESPONSE (src/rendering/orchestrator/html.ts)                                 │
  │  ════════════════════════════════════════════════════════════════════════════════════   │
  │                                                                                         │
  │   ┌─────────────────────────────┐    ┌─────────────────────────────────────────────┐    │
  │   │     String Delivery         │    │      Stream Delivery                        │    │
  │   │  ─────────────────────────  │    │   ─────────────────────────────             │    │
  │   │  HTMLGenerator.             │    │   ReadableStream combining:                 │    │
  │   │    generateFullHTML()       │    │   • HTML shell start                        │    │
  │   │  • Full document with meta  │    │   • React stream chunks                     │    │
  │   │  • Hydration scripts        │    │   • HTML shell end                          │    │
  │   │  • CSP nonce                │    │   Transfer-Encoding: chunked                │    │
  │   └─────────────────────────────┘    └─────────────────────────────────────────────┘    │
  │                                                                                         │
  │   Headers: Content-Type, Cache-Control, ETag, CSP                                       │
  └─────────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ▼
                                     HTTP Response
```

---

🗄️ Caching Layers Deep Dive

```text
  ┌─────────────────────────────────────────────────────────────────────────────────────────┐
  │                                    CACHING ARCHITECTURE                                 │
  └─────────────────────────────────────────────────────────────────────────────────────────┘

  Request Flow Through Caches:
  ═══════════════════════════

      ┌──────────────────────────────────────────────────────────────────────────────────┐
      │  L1: RENDER CACHE (ContextAwareCacheCoordinator)                      ⚡ ~1ms     │
      │  ─────────────────────────────────────────────                                   │
      │  Key:     {projectId}:{env}:{releaseId}:{slug}:{colorScheme}                     │
      │  Storage: Memory (default) | Redis | Deno KV | API                               │
      │  Max:     500 entries (configurable)                                             │
      │  TTL:     Per-context (no default TTL)                                           │
      │  Hit?     Return cached HTML immediately                                         │
      └──────────────────────────────────────────────────────────────────────────────────┘
                                           │ MISS
                                           ▼
      ┌──────────────────────────────────────────────────────────────────────────────────┐
      │  L2: MODULE CACHE (in-memory Map)                                     ⚡ ~5ms     │
      │  ─────────────────────────────────                                               │
      │  Key:     {projectId}:{filePath}                                                 │
      │  Storage: Per-pod memory                                                         │
      │  Content: Path to transformed .mjs file                                          │
      │  Lifetime: Pod lifetime                                                          │
      └──────────────────────────────────────────────────────────────────────────────────┘
                                           │ MISS
                                           ▼
      ┌──────────────────────────────────────────────────────────────────────────────────┐
      │  L3: TRANSFORM CACHE (Distributed)                                   ⚡ ~50ms     │
      │  ──────────────────────────────────                                              │
      │  Key:     v{VERSION}:{projectId}:{path}:{contentHash}                            │
      │  Storage: Redis (distributed) or API                                             │
      │  Content: Transformed code + bundle manifest ID                                  │
      │  TTL:     24 hours (TRANSFORM_DISTRIBUTED_TTL_SEC)                               │
      │  Shared:  Across all pods                                                        │
      └──────────────────────────────────────────────────────────────────────────────────┘
                                           │ MISS
                                           ▼
      ┌──────────────────────────────────────────────────────────────────────────────────┐
      │  L4: HTTP BUNDLE CACHE (File System)                                 ⚡ ~100ms    │
      │  ─────────────────────────────────────                                           │
      │  Location: /.cache/veryfront-http-bundle/                                        │
      │  Content:  esbuild-bundled dependencies (react, lodash, etc.)                    │
      │  Validation: Bundle manifest (atomic) or file existence                          │
      │  Recovery: recoverHttpBundleByHash() → re-fetch from esm.sh                      │
      └──────────────────────────────────────────────────────────────────────────────────┘
                                           │ MISS
                                           ▼
      ┌──────────────────────────────────────────────────────────────────────────────────┐
      │  TRANSFORM FROM SOURCE                                               🐢 ~500ms+   │
      │  ─────────────────────────                                                       │
      │  • Read source file                                                              │
      │  • transformToESM() via esbuild                                                  │
      │  • Resolve @/ imports recursively                                                │
      │  • Fetch HTTP dependencies from esm.sh                                           │
      │  • Write to cache layers                                                         │
      └──────────────────────────────────────────────────────────────────────────────────┘

      ┌──────────────────────────────────────────────────────────────────────────────────┐
      │  L5: CSS CACHE (Page-level)                                          ⚡ ~10ms     │
      │  ───────────────────────────                                                     │
      │  Key:     {projectId}:{env}:{slug}:{projectUpdatedAt}                            │
      │  Storage: In-memory Map                                                          │
      │  Max:     200 entries (PAGE_CSS_CACHE_MAX_SIZE)                                  │
      │  Content: Generated Tailwind CSS                                                 │
      └──────────────────────────────────────────────────────────────────────────────────┘

      ┌──────────────────────────────────────────────────────────────────────────────────┐
      │  L6: DATA CACHE (getStaticData only)                                             │
      │  ────────────────────────────────────                                            │
      │  Key:     hash(function_code + params)                                           │
      │  Storage: CacheManager (in-memory)                                               │
      │  TTL:     Per-function revalidate setting                                        │
      └──────────────────────────────────────────────────────────────────────────────────┘
```
