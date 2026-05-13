# Discovery, Extensions & Observability

## Discovery Engine

The discovery engine automatically finds, validates, and registers AI primitives (tools, agents, workflows, prompts, resources, skills) at server startup.

```mermaid
flowchart TD
    subgraph Startup["Server Startup"]
        DiscoverAll["discoverAll(config)"]
    end

    subgraph Scan["File Discovery"]
        ToolDir["tools/**/*.ts"]
        AgentDir["agents/**/*.ts"]
        WorkflowDir["workflows/**/*.ts"]
        PromptDir["prompts/**/*.ts"]
        ResourceDir["resources/**/*.ts"]
        SkillDir["skills/**/SKILL.md"]
    end

    subgraph Process["Processing Pipeline"]
        PatternMatch["Pattern Matching<br/>(*.ts, *.tsx files)"]
        Transpile["Transpile TypeScript<br/>(esbuild transform)"]
        DynImport["Dynamic Import<br/>(import module)"]
        ExtractExport["Extract Export<br/>(default or named)"]
    end

    subgraph Validate["Validation & Registration"]
        Handler{"Match handler<br/>by type?"}
        ToolHandler["Tool Handler<br/>validate Tool instance<br/>derive ID from file/export"]
        AgentHandler["Agent Handler<br/>validate Agent instance"]
        WorkflowHandler["Workflow Handler<br/>validate WorkflowDefinition"]
        PromptHandler["Prompt Handler<br/>validate Prompt instance"]
        ResourceHandler["Resource Handler<br/>validate Resource instance"]
        SkillHandler["Skill Handler<br/>parse SKILL.md frontmatter"]
    end

    subgraph Registries["Global Registries (Project-Scoped)"]
        ToolReg["Tool Registry"]
        AgentReg["Agent Registry"]
        WorkflowReg["Workflow Registry"]
        PromptReg["Prompt Registry"]
        ResourceReg["Resource Registry"]
        SkillReg["Skill Registry"]
    end

    subgraph Result["Discovery Result"]
        ResultMap["DiscoveryResult{<br/>  tools: Map,<br/>  agents: Map,<br/>  workflows: Map,<br/>  prompts: Map,<br/>  resources: Map,<br/>  skills: Map,<br/>  errors: DiscoveryError[]<br/>}"]
    end

    DiscoverAll --> Scan
    Scan --> PatternMatch
    PatternMatch --> Transpile
    Transpile --> DynImport
    DynImport --> ExtractExport
    ExtractExport --> Handler

    Handler -->|tool| ToolHandler
    Handler -->|agent| AgentHandler
    Handler -->|workflow| WorkflowHandler
    Handler -->|prompt| PromptHandler
    Handler -->|resource| ResourceHandler
    Handler -->|skill| SkillHandler

    ToolHandler --> ToolReg
    AgentHandler --> AgentReg
    WorkflowHandler --> WorkflowReg
    PromptHandler --> PromptReg
    ResourceHandler --> ResourceReg
    SkillHandler --> SkillReg

    Registries --> ResultMap
```

### Description

The discovery engine follows a convention-over-configuration approach:

1. **Scan:** Each primitive type has a convention-based directory (`tools/`, `agents/`, `workflows/`, etc.). Files matching `**/*.ts` and `**/*.tsx` are collected. Note: test files in discovery directories will be imported -- place tests outside these directories or use separate test directories.
2. **Process:** TypeScript files are transpiled via esbuild, dynamically imported, and their exports (default or named) are extracted.
3. **Validate:** Each handler validates that the export is a valid instance of its type (e.g., a `Tool` with an `execute` function and `inputSchema`). IDs are derived from the handler's `getId()` method or fall back to the export/file name.
4. **Register:** Valid primitives are registered in project-scoped registries. Registration makes them available to agents, the MCP server, and the workflow engine.
5. **Error Handling:** Discovery is fault-tolerant -- individual file failures (syntax errors, validation failures) are collected as `DiscoveryError` entries but don't block other files from loading.

The result is a `DiscoveryResult` containing Maps of all discovered primitives and any errors encountered.

---

## Extension System

The extension system is a lightweight contract-based runtime for wiring optional capabilities into `veryfront-code`.

```mermaid
graph TB
    subgraph ExtDef["Extension Definition"]
        ExtInterface["Extension Interface<br/>{name, version, capabilities,<br/>setup(), teardown(), provides?, extends?}"]
        Capability["Capability Declaration<br/>(required runtime features)"]
    end

    subgraph Contracts["Contracts and Recommendations (14 domains)"]
        Bundler["Bundler"]
        ModuleLexer["ModuleLexer"]
        CacheStore["CacheStore"]
        TokenCacheStore["TokenCacheStore"]
        CSSProcessor["CSSProcessor"]
        ContentTx["ContentTransformer"]
        DatabaseClient["DatabaseClient"]
        AuthProvider["AuthProvider"]
        TracingExporter["TracingExporter"]
        LLMProviderRegistry["LLMProviderRegistry"]
        LLMProvider["LLMProvider:*<br/>(anthropic, openai, google)"]
        EmbeddingProvider["EmbeddingProvider"]
        CodeParser["CodeParser"]
        SchemaValidator["SchemaValidator"]
        NodeCompat["NodeCompat"]
    end

    subgraph ContractSystem["Contract System"]
        Require["context.require(contract)<br/>→ get implementation"]
        Provide["context.provide(contract, impl)<br/>→ register implementation"]
        Get["context.get(contract)<br/>→ optional lookup"]
    end

    subgraph Registry2["Contract Registry"]
        Register["register(contract, impl)"]
        Resolve["resolve(contract)<br/>→ implementation"]
        TryResolve["tryResolve(contract)<br/>→ implementation?"]
        Reset["reset()<br/>clear registry"]
    end

    subgraph Lifecycle["Extension Lifecycle"]
        Setup["setup(context)<br/>(register implementations)"]
        Active["Extension Active<br/>(contracts available)"]
        Teardown["teardown()<br/>(optional cleanup)"]
    end

    subgraph Recommendations["Recommendations Engine"]
        Recommend["getRecommendation(contract)<br/>→ suggested package"]
    end

    Contracts --> ContractSystem
    ContractSystem --> Registry2
    ExtDef --> Lifecycle
    Setup --> Register
    Resolve --> Active
    Active --> Teardown
    Contracts -.-> Recommendations
```

### Description

The extension system currently provides:

- **Extension Definitions:** An extension declares `name`, `version`, `capabilities`, and optional `setup()` / `teardown()` hooks, plus optional `provides` and `extends` fields.
- **Extension Context:** `ExtensionContext` exposes `get()`, `require()`, `provide()`, a config bag, and a logger so extensions can register implementations into the runtime.
- **Contract Registry:** The runtime registry is currently a small in-memory contract map with `register()`, `resolve()`, `tryResolve()`, and `reset()`.
- **Recommendations:** Some contract names map to recommended first-party extension packages via `getRecommendation()`, which is used to improve missing-contract errors.

Current first-party extension packages: `@veryfront/ext-zod` (SchemaValidator), `@veryfront/ext-llm-anthropic` (LLMProvider:anthropic), `@veryfront/ext-llm-google` (LLMProvider:google), `@veryfront/ext-llm-openai` (LLMProvider:openai), `@veryfront/ext-auth-jwt` (AuthProvider), `@veryfront/ext-bundler-esbuild` (Bundler + ModuleLexer), `@veryfront/ext-cache-redis` (TokenCacheStore), `@veryfront/ext-css-tailwind` (CSSProcessor), `@veryfront/ext-node-compatibility` (NodeCompat), `@veryfront/ext-parser-babel` (CodeParser), `@veryfront/ext-tracing-opentelemetry` (TracingExporter), `@veryfront/ext-transform-mdx` (ContentTransformer).

---

## Observability System

```mermaid
graph TB
    subgraph Instrumentation["Auto-Instrumentation"]
        HTTPInstr["HTTP Handler<br/>(request duration, status codes)"]
        FetchInstr["Fetch<br/>(outbound requests)"]
        RenderInstr["React Render<br/>(SSR/RSC timing)"]
        ErrorInstr["Error Collection<br/>(structured errors)"]
        ReqCtx["Request / Trace Context<br/>(request_id, project_slug,<br/>trace_id when active)"]
    end

    subgraph Tracing["Distributed Tracing"]
        OTel["OpenTelemetry SDK"]
        Spans["Span Management<br/>(create, annotate, close)"]
        PropCtx["Context Propagation<br/>(trace ID across services)"]
    end

    subgraph Metrics["Metrics Collection"]
        HTTPMetrics["HTTP Metrics<br/>(method, status, duration)"]
        CacheMetrics["Cache Metrics<br/>(hit/miss, size, evictions)"]
        RenderMetrics["Render Metrics<br/>(SSR time, RSC time)"]
        BuildMetrics["Build Metrics<br/>(duration, bundle size)"]
        AIMetrics["AI Metrics<br/>(token usage, latency)"]
    end

    subgraph ErrorHandling["Error Handling"]
        Collector["Error Collector<br/>(structured tracking)"]
        Filter["Error Filtering<br/>(severity, dedup)"]
        DevOverlay["Dev Error Overlay<br/>(browser display)"]
        GlobalHandler["Global Error Handler<br/>(prevent crashes)"]
    end

    subgraph Export["Export"]
        OTelExport["OpenTelemetry Exporters<br/>(OTLP-compatible backends)"]
        Console["Console Logging<br/>(structured JSON)"]
    end

    Instrumentation --> Tracing
    Instrumentation --> Metrics
    Instrumentation --> ErrorHandling

    Tracing --> OTel
    Metrics --> OTel
    OTel --> Export
    ErrorHandling --> Export
```

### Description

The observability system combines several source-backed pieces:

- **Tracing:** OpenTelemetry tracing utilities, OTLP setup, span helpers, and context propagation for HTTP/fetch/render flows.
- **Metrics:** OpenTelemetry metrics plus a simpler in-process metrics surface used by runtime handlers and monitoring endpoints such as `/_metrics`.
- **Auto-Instrumentation Helpers:** Wrappers exist for HTTP handlers, fetch, React render paths, and error handlers; they are opt-in helpers initialized through `initAutoInstrumentation()`.
- **Errors and Logs:** The repo includes a structured error collector, log buffering, and dev-facing error surfaces for debugging.

Request context propagation enriches logs with request and project context, and the trace bridge can add `trace_id` / `span_id` fields when OpenTelemetry tracing is active.

---

## Security Architecture

```mermaid
flowchart TD
    subgraph RequestBoundary["Request Boundary (Validate Here)"]
        InputVal["Input Validation<br/>(Zod schemas at all boundaries)"]
        PathTraversal["Path Traversal Protection<br/>(normalize + reject ../)"]
        CORS2["CORS<br/>(origin allowlisting)"]
        CSRF["CSRF Protection<br/>(token validation)"]
        RateLimit["Rate Limiting<br/>(per-IP, per-route)"]
        CSP["Content Security Policy<br/>(strict headers)"]
    end

    subgraph AuthLayer["Authentication"]
        OAuth2["OAuth Flows<br/>(Google, GitHub, etc.)"]
        TokenMgmt["Token / Session Handling<br/>(runtime- and config-dependent)"]
        BearerAuth["Bearer Token Auth<br/>(MCP server)"]
    end

    subgraph AISecLayer["AI Security"]
        PromptInjection["Prompt Injection Detection<br/>(agent middleware, on by default)"]
        ToolValidation["Tool Input Validation<br/>(Zod schema enforcement)"]
        SkillAllowed["Skill Allowed Tools<br/>(pattern-based filtering)"]
        ResultLimits["Result Size Limits<br/>(64KB tool results, 64KB context)"]
        RequestLimits["Request Size Limits<br/>(1MB MCP, 128KB control plane)"]
    end

    subgraph Internal["Internal Conventions"]
        InternalCode["Internal Code<br/>(no redundant validation)"]
        HashImports["Hash Imports (#veryfront/*)<br/>(internal import aliasing)"]
        BrandedIDs["Branded Types<br/>(UserId, AgentId, ToolId)"]
    end

    RequestBoundary --> AuthLayer
    RequestBoundary --> AISecLayer
    AuthLayer --> Internal
    AISecLayer --> Internal
```

### Description

Security follows a boundary-based validation model:

- **Request Boundary:** All user input is validated at the system boundary using Zod schemas. Path traversal protection normalizes and rejects directory traversal attempts. CORS, CSRF, rate limiting, and CSP headers are enforced at the middleware level.
- **Authentication:** OAuth flows, CSRF support, and MCP Bearer-token authentication are part of the current security surface. Token/session storage details vary by runtime and deployment mode.
- **AI Security:** Prompt injection detection runs as agent middleware by default. Tool inputs are validated against Zod schemas before execution. Skills can restrict which tools are available via pattern-based filtering. Request size limits include 1MB for MCP and 128KB for the internal agent control plane.
- **Internal:** Inside the trust boundary, internal code relies on framework guarantees without redundant validation. Hash imports (`#veryfront/*`) are an internal aliasing convention, and branded types provide compile-time ID discrimination.

---

## Cache System

```mermaid
graph LR
    subgraph CacheLayers["Cache Layers"]
        L1["L1: Memory Cache<br/>(LRU, per-process)"]
        L2["L2: Redis Cache<br/>(shared, distributed)"]
        L3["L3: File Cache<br/>(persistent, local disk)"]
    end

    subgraph Features["Cache Features"]
        TagGrouping["Tag-Based Grouping<br/>(invalidate by tag)"]
        TTL["TTL Management<br/>(per-entry expiry)"]
        LRU["LRU Eviction<br/>(size + count limits)"]
        Distributed["Distributed Invalidation<br/>(WebSocket for FS cache)"]
    end

    subgraph Consumers["Cache Consumers"]
        FSCache["FS Adapter Cache<br/>(100MB, 1000 entries, 60s)"]
        ModuleCache["Module Cache<br/>(compiled components)"]
        DataCache["Data Cache<br/>(getServerData results)"]
        ProviderCache["Provider Cache<br/>(model resolution)"]
    end

    Consumers --> L1
    L1 -->|miss| L2
    L2 -->|miss| L3
    L3 -->|miss| Source["Origin Source"]

    Features --> CacheLayers
```

### Description

The multi-layer cache system optimizes performance across all framework subsystems:

- **L1 (Memory):** In-process LRU cache for hot data. Fastest but limited to the process lifetime.
- **L2 (Redis):** Shared cache across processes/instances. Enables cache coherency in multi-instance deployments.
- **L3 (File):** Persistent file-based cache on local disk. Survives process restarts.

Features include tag-based grouping (invalidate all entries with a given tag), per-entry TTL, LRU eviction with configurable size and count limits, and distributed invalidation via WebSocket for the filesystem cache.

Major consumers: the FS adapter (100MB, 1000 entries, 60s TTL for remote files), the module cache (compiled components), the data cache (`getServerData` results), and the provider cache (model resolution).
