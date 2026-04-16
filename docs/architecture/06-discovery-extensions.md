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
        PatternMatch["Pattern Matching<br/>(exclude *.test.ts, *.spec.ts)"]
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

1. **Scan:** Each primitive type has a convention-based directory (`tools/`, `agents/`, `workflows/`, etc.). Files matching `**/*.ts` are collected, excluding test files (`*.test.ts`, `*.spec.ts`).
2. **Process:** TypeScript files are transpiled via esbuild, dynamically imported, and their exports (default or named) are extracted.
3. **Validate:** Each handler validates that the export is a valid instance of its type (e.g., a `Tool` with an `execute` function and `inputSchema`). IDs are derived from the handler's `getId()` method or fall back to the export/file name.
4. **Register:** Valid primitives are registered in project-scoped registries. Registration makes them available to agents, the MCP server, and the workflow engine.
5. **Error Handling:** Discovery is fault-tolerant -- individual file failures (syntax errors, validation failures) are collected as `DiscoveryError` entries but don't block other files from loading.

The result is a `DiscoveryResult` containing Maps of all discovered primitives and any errors encountered.

---

## Extension System

The extension system provides a contract-based dependency injection pattern for extending veryfront with additional capabilities.

```mermaid
graph TB
    subgraph ExtDef["Extension Definition"]
        ExtInterface["Extension Interface<br/>{name, version, capabilities,<br/>setup(), teardown()}"]
        Capability["Capability Declaration<br/>(what the extension requires/provides)"]
        Source["Extension Source<br/>config | package | project | local-file"]
    end

    subgraph Contracts["Contract Interfaces (12 domains)"]
        AuthContract["Auth Contract"]
        StorageContract["Storage Contract"]
        CacheContract["Cache Contract"]
        QueueContract["Queue Contract"]
        EmailContract["Email Contract"]
        SearchContract["Search Contract"]
        PaymentContract["Payment Contract"]
        AnalyticsContract["Analytics Contract"]
        LoggingContract["Logging Contract"]
        DatabaseContract["Database Contract"]
        FileStorageContract["File Storage Contract"]
        NotificationContract["Notification Contract"]
    end

    subgraph ContractSystem["Contract System"]
        ContractDef["Contract Definition<br/>(typed interface contract)"]
        Require["context.require(contract)<br/>→ get implementation"]
        Provide["context.provide(contract, impl)<br/>→ register implementation"]
    end

    subgraph Registry2["Contract Registry"]
        Register["register(contract, impl)"]
        Resolve["resolve(contract)<br/>→ implementation"]
        Validate["validateConflicts()<br/>(detect duplicate providers)"]
        ListContracts["listContracts()"]
    end

    subgraph Loader["Extension Loader"]
        MultiSource["Multi-Source Discovery<br/>(config, packages, project, local)"]
        TopoSort["Topological Sort<br/>(dependency ordering)"]
        CapAudit["Capability Audit<br/>(+ Deno permission mapping)"]
    end

    subgraph Lifecycle["Extension Lifecycle"]
        Load["Load Extensions"]
        ValidateCaps["Validate Capabilities<br/>(can requirements be met?)"]
        Setup["setup(context)<br/>(register implementations)"]
        Active["Extension Active<br/>(contracts available)"]
        Teardown["teardown(context)<br/>(cleanup resources)"]
    end

    subgraph ExtCLI["Extension CLI"]
        InitCmd["veryfront ext init<br/>(scaffold extension)"]
        ValidateCmd["veryfront ext validate<br/>(check contracts + capabilities)"]
    end

    subgraph Recommendations["Recommendations Engine"]
        Analyze["Analyze project needs"]
        Suggest["Suggest extensions<br/>based on capabilities"]
    end

    ExtDef --> Loader
    Contracts --> ContractSystem
    ContractSystem --> Registry2
    Loader --> Lifecycle
    MultiSource --> TopoSort --> CapAudit
    Load --> ValidateCaps --> Setup --> Active
    Active --> Teardown
    Recommendations -.-> Suggest
    ExtCLI -.-> Loader
```

### Description

The extension system:

- **Extensions** declare a name, version, required capabilities, and `setup()`/`teardown()` lifecycle hooks. They can be loaded from configuration files, npm packages, the project directory, or local files.
- **12 Contract Interfaces** cover the major integration domains: auth, storage, cache, queue, email, search, payment, analytics, logging, database, file storage, and notifications. Each contract is a typed interface that decouples providers from consumers (see PRs #1028, #1008).
- **Contract Registry** manages the mapping from contracts to implementations, with conflict detection for duplicate providers. It supports listing all registered contracts and resolving implementations at runtime.
- **Extension Loader** discovers extensions from multiple sources (config, packages, project, local files), topologically sorts them by dependency order, and audits capabilities against Deno permissions (see PRs #1031, #1035, #1029, #1030).
- **Lifecycle:** Extensions are loaded, capabilities are validated (can all requirements be satisfied?), then `setup()` is called with the `ExtensionContext` for registration. On shutdown, `teardown()` handles cleanup.
- **Extension CLI:** `veryfront ext init` scaffolds a new extension; `veryfront ext validate` checks contracts and capabilities (see PR #1034).
- **Recommendations:** The recommendations engine analyzes the project's needs and suggests relevant extensions based on capability gaps.

---

## Observability System

```mermaid
graph TB
    subgraph Instrumentation["Auto-Instrumentation"]
        HTTPInstr["HTTP Handler<br/>(request duration, status codes)"]
        FetchInstr["Fetch<br/>(outbound requests)"]
        RenderInstr["React Render<br/>(SSR/RSC timing)"]
        ErrorInstr["Error Collection<br/>(structured errors)"]
        ReqCtx["Request Context<br/>(user_id, conversation_id)"]
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
        OTelExport["OpenTelemetry Exporters<br/>(Jaeger, Datadog, etc.)"]
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

The observability system provides three pillars:

- **Distributed Tracing:** OpenTelemetry integration with span management and context propagation across services. Traces capture the full request lifecycle from HTTP entry to rendering to external API calls.
- **Metrics:** Automatic collection of HTTP metrics (request count, duration, status), cache metrics (hit rate, size, evictions), render metrics (SSR/RSC timing), build metrics (duration, bundle sizes), and AI metrics (token usage, provider latency).
- **Error Handling:** A structured error collector with severity-based filtering and deduplication. In development, errors are displayed via a browser overlay. In production, a global error handler prevents process crashes from non-fatal errors while allowing fatal errors (stack overflow, out of memory) to trigger container restarts.

Auto-instrumentation wraps HTTP handlers, fetch calls, React renders, and error boundaries without requiring manual code changes. Request context propagation attaches `user_id` and `conversation_id` to log entries for agent tracing (see PR #1085).

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
        TokenMgmt["Token Management<br/>(memory, SQLite dev, API cloud)"]
        SessionMgmt["Session Management<br/>(secure cookies)"]
        BearerAuth["Bearer Token Auth<br/>(MCP server)"]
    end

    subgraph AISecLayer["AI Security"]
        PromptInjection["Prompt Injection Detection<br/>(agent middleware, on by default)"]
        ToolValidation["Tool Input Validation<br/>(Zod schema enforcement)"]
        SkillAllowed["Skill Allowed Tools<br/>(pattern-based filtering)"]
        ResultLimits["Result Size Limits<br/>(64KB tool results, 64KB context)"]
        RequestLimits["Request Size Limits<br/>(1MB MCP, 128KB control plane)"]
    end

    subgraph Internal["Internal (Trust)"]
        InternalCode["Internal Code<br/>(no redundant validation)"]
        HashImports["Hash Imports (#veryfront/*)<br/>(enforced module boundaries)"]
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
- **Authentication:** OAuth flows support multiple providers (Google, GitHub, etc.). Token storage uses memory in development, SQLite for local persistence, and the Veryfront API for cloud deployments. The MCP server uses Bearer token authentication.
- **AI Security:** Prompt injection detection runs as agent middleware (enabled by default). Tool inputs are validated against Zod schemas before execution. Skills can restrict which tools are available via pattern-based filtering. Result and request size limits prevent abuse.
- **Internal:** Inside the trust boundary, internal code relies on framework guarantees without redundant validation. Hash imports (`#veryfront/*`) enforce module boundaries. Branded types provide compile-time ID discrimination.

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
