# Request Handling & Server Pipeline

## Production Server Bootstrap

The production server follows a deterministic startup sequence that works identically across all supported runtimes.

```mermaid
sequenceDiagram
    participant CLI as CLI / Entry Point
    participant Boot as Bootstrap
    participant Registry as AdapterRegistry
    participant Adapter as RuntimeAdapter
    participant FSFactory as FSAdapter Factory
    participant Discovery as Discovery Engine
    participant Server as HTTP Server

    CLI->>Registry: runtime.get()
    Registry->>Registry: detectRuntime()<br/>(Deno/Node/Bun/CF)
    Registry->>Adapter: lazy load + initialize()
    Registry-->>CLI: RuntimeAdapter

    CLI->>Boot: bootstrap(projectDir, adapter)
    Boot->>Boot: initializeEsbuild()
    Boot->>Boot: loadEnvFiles(.env)
    Boot->>Boot: loadConfig(veryfront.config.ts)

    alt FS adapter configured (veryfront-api or github)
        Boot->>FSFactory: createFSAdapter(config)
        FSFactory-->>Boot: VeryfrontFSAdapter | GitHubFSAdapter
        Boot->>Adapter: enhanceAdapterWithFS(fsAdapter)
    end

    Boot-->>CLI: BootstrapResult{adapter, config}

    CLI->>Discovery: discoverAll(baseDir)
    Discovery->>Discovery: Scan tools/, agents/,<br/>workflows/, prompts/,<br/>resources/, skills/
    Discovery->>Discovery: Transpile + import modules
    Discovery->>Discovery: Register in global registries

    CLI->>Server: adapter.serve(handler, {port, hostname})
    Note over Server: Deno.serve() / Bun.serve()<br/>/ http.createServer()
    Server-->>CLI: ServerHandle{ready, stop}
```

### Description

1. **Runtime Detection:** The `AdapterRegistry` singleton detects the current runtime (Deno, Node.js, Bun, or Cloudflare Workers) by checking for global objects (`Deno`, `Bun`, `process.versions.node`, `caches`).
2. **Bootstrap:** Initializes esbuild, loads `.env` files, and reads `veryfront.config.ts`. If a virtual filesystem is configured (Veryfront API or GitHub), the adapter is enhanced with the FS layer.
3. **Discovery:** The discovery engine scans convention-based directories (`tools/`, `agents/`, `workflows/`, etc.), transpiles TypeScript modules, dynamically imports them, and registers them in global registries.
4. **Server Start:** The runtime adapter starts the HTTP server using the platform-native API. All runtimes expose a standard `Request => Response` handler interface.

---

## Request Handling Pipeline

Every incoming HTTP request passes through the same pipeline regardless of runtime.

```mermaid
flowchart TD
    Request["Incoming Request"]
    RuntimeHandler["Runtime Handler<br/>(platform-agnostic)"]

    subgraph Routing["Route Resolution"]
        RouteMatch{"Match route type?"}
        StaticFile["Static File<br/>(/_vf_modules/, assets/)"]
        APIRoute["API Route<br/>(app/api/**/route.*<br/>or pages/api/**)"]
        PageRoute["Page Route<br/>(app/**/page.*<br/>or pages/**)"]
        MCPEndpoint["MCP Endpoint<br/>(configurable path, default /mcp)"]
        AgentEndpoint["AG-UI Endpoint<br/>(package default /api/ag-ui;<br/>current control-plane wrapper /api/control-plane/agents/stream)"]
    end

    subgraph MiddlewarePipeline["Middleware Pipeline"]
        SecurityMW["Security Middleware<br/>(input validation, path traversal)"]
        CORSMW["CORS Middleware"]
        RateLimitMW["Rate Limiting"]
        AuthMW["Auth / OAuth Middleware"]
        CSPMW["CSP Headers"]
        CustomMW["User Middleware<br/>(veryfront.config.ts)"]
    end

    subgraph Handlers["Response Handlers"]
        StaticHandler["Static File Server<br/>(cache headers, compression)"]

        subgraph APIHandler["API Handler"]
            ValidateInput["Validate Request"]
            ExecAPI["Execute Handler Function"]
            SerializeJSON["Serialize JSON Response"]
        end

        subgraph PageHandler["Page Rendering"]
            DataFetch["getServerData(ctx)<br/>(data fetching)"]
            LayoutDiscover["Discover Layouts<br/>(layout.tsx, error.tsx)"]
            SSR["SSR Renderer<br/>(React.renderToString)"]
            RSC{"RSC enabled?"}
            RSCTransform["RSC Transform"]
            StreamResponse["Streaming Response<br/>(with Suspense boundaries)"]
            HTMLGen["HTML Generation<br/>(hydration script, metadata)"]
        end

        subgraph MCPHandler["MCP Handler"]
            SessionValidate["Session Validation"]
            JSONRPCDispatch["JSON-RPC Dispatch"]
            ToolExec["Tool / Resource / Prompt"]
        end

        subgraph AgentHandler["Agent Stream Handler"]
            AgentParse["Parse AG-UI Request"]
            AgentExec["Agent Runtime Execution"]
            SSEStream["SSE Stream Response"]
        end
    end

    Response["HTTP Response"]

    Request --> RuntimeHandler
    RuntimeHandler --> RouteMatch

    RouteMatch -->|"/_vf_modules/*<br/>static assets"| StaticFile
    RouteMatch -->|"/api/*"| APIRoute
    RouteMatch -->|"page path"| PageRoute
    RouteMatch -->|"/mcp"| MCPEndpoint
    RouteMatch -->|"/api/control-plane/agents/stream"| AgentEndpoint

    StaticFile --> StaticHandler
    APIRoute --> MiddlewarePipeline
    PageRoute --> MiddlewarePipeline
    MCPEndpoint --> MCPHandler
    AgentEndpoint --> AgentHandler

    MiddlewarePipeline --> APIHandler
    MiddlewarePipeline --> PageHandler

    DataFetch --> LayoutDiscover
    LayoutDiscover --> SSR
    SSR --> RSC
    RSC -->|yes| RSCTransform --> StreamResponse
    RSC -->|no| StreamResponse
    StreamResponse --> HTMLGen

    StaticHandler --> Response
    SerializeJSON --> Response
    HTMLGen --> Response
    ToolExec --> Response
    SSEStream --> Response
```

### Description

The request pipeline has five route categories:

- **Static Files:** Served directly with cache headers and optional compression. No middleware needed.
- **API Routes:** Pass through the full middleware pipeline, then execute the user-defined handler function. Depending on router mode, these come from `app/api/**/route.*` or `pages/api/**`. Input is validated and output is serialized as JSON.
- **Page Routes:** The most complex path. After middleware, the rendering engine fetches data via `getServerData()`, resolves the active router mode, runs SSR, optionally applies RSC transforms, and streams the HTML response with Suspense boundaries and hydration scripts. Both router modes can apply matching `layout.tsx` and `error.tsx` files, but the composition rules differ between app-router and pages-router projects.
- **MCP Endpoints:** Handle JSON-RPC requests for the MCP protocol. Session validation, dispatch to tools/resources/prompts, and support for async tasks.
- **AG-UI Endpoints:** The package-level AG-UI handlers are designed around host-configurable routes such as `/api/ag-ui`, but the current Studio/control-plane path uses the signed compatibility wrapper at `/api/control-plane/agents/stream`. This transport is separate from MCP and streams AG-UI SSE events back to the client.

---

## Rendering Pipeline Detail

```mermaid
flowchart LR
    subgraph Input["Page Input"]
        PageFile["Page Component<br/>(app/about/page.*<br/>or pages/about.*)"]
        Layouts["Layout Chain<br/>(matching app/**/layout.*<br/>or pages/**/layout.*)"]
        ErrorBoundaries["Error Boundaries<br/>(matching app/**/error.*<br/>or pages/**/error.*)"]
    end

    subgraph DataPhase["Data Phase"]
        ServerData["getServerData(ctx)<br/>→ props for page"]
        StaticPaths["getStaticPaths()<br/>→ routes for SSG"]
    end

    subgraph RenderPhase["Render Phase"]
        LayoutCompile["Compile Layout Tree<br/>(wrap children recursively)"]
        ComponentLoad["Load Components<br/>(resolve client/server)"]
        ReactRender["React.renderToString()<br/>or renderToReadableStream()"]
    end

    subgraph OutputPhase["Output Phase"]
        RSCCheck{"RSC<br/>enabled?"}
        RSCPayload["Generate RSC Payload"]
        HTMLShell["HTML Shell<br/>(doctype, head, body)"]
        HydrationScript["Hydration Script<br/>(client-side bootstrap)"]
        MetaTags["Meta Tags<br/>(SEO, Open Graph)"]
        StreamOut["Streaming Output<br/>(chunked transfer)"]
    end

    PageFile --> ServerData
    Layouts --> LayoutCompile
    ErrorBoundaries --> LayoutCompile
    ServerData --> LayoutCompile
    StaticPaths -.->|"SSG only"| ServerData

    LayoutCompile --> ComponentLoad
    ComponentLoad --> ReactRender

    ReactRender --> RSCCheck
    RSCCheck -->|yes| RSCPayload --> HTMLShell
    RSCCheck -->|no| HTMLShell
    HTMLShell --> HydrationScript
    HydrationScript --> MetaTags
    MetaTags --> StreamOut
```

### Description

The rendering pipeline converts page components into streamed HTML:

1. **Data Phase:** `getServerData(ctx)` runs server-side to fetch props. For SSG, `getStaticPaths()` enumerates routes at build time.
2. **Render Phase:** The renderer resolves the active route file, then applies router-specific composition. In app-router mode it compiles nested `layout.tsx` and `error.tsx` files along the route tree. In pages-router mode it applies matching `pages/**/layout.tsx` and `pages/**/error.tsx` wrappers when present. Components are then resolved as client or server components and rendered via React's streaming API.
3. **Output Phase:** If RSC is enabled, an RSC payload is generated alongside the HTML. The output includes the HTML shell, hydration scripts for client-side bootstrapping, and SEO meta tags. The response is streamed using chunked transfer encoding with Suspense boundary support.

---

## Dev Server Architecture

```mermaid
flowchart TD
    subgraph DevServer["Development Server"]
        FileWatcher["File Watcher<br/>(debounced, per-runtime)"]
        HMR["HMR Engine<br/>(Hot Module Replacement)"]
        FastRefresh["React Fast Refresh<br/>(state-preserving updates)"]
        ModuleServer["Module Server<br/>(/_vf_modules/*)"]
        ErrorOverlay["Error Overlay<br/>(dev-only error display)"]
        ImportRewriter["Import Rewriter<br/>(6 strategies)"]
    end

    subgraph Strategies["Import Rewriting Strategies"]
        Relative["relative-strategy<br/>(./Button → /_vf_modules/.../Button)"]
        ReactStrat["react-strategy<br/>(react → React library)"]
        VfStrat["veryfront-strategy<br/>(#veryfront/* → /_vf_modules/_veryfront/*)"]
        AliasStrat["alias-strategy<br/>(path aliases)"]
        VendorStrat["vendor-strategy<br/>(npm → esm.sh CDN)"]
        CrossProj["cross-project-strategy<br/>(registry URL)"]
    end

    FileWatcher -->|"file changed"| HMR
    HMR --> FastRefresh
    HMR --> ModuleServer
    ModuleServer --> ImportRewriter
    ImportRewriter --> Strategies
    HMR -->|"error"| ErrorOverlay
```

### Description

The dev server provides a fast feedback loop:

- **File Watcher:** Monitors the project directory for changes. Uses platform-native watching (Deno poll-based due to limitations, Node `fs.watch`, Bun native watcher).
- **HMR Engine:** Processes file changes and sends updates to the browser via WebSocket.
- **React Fast Refresh:** Preserves React component state during hot updates.
- **Module Server:** Serves transformed modules at `/_vf_modules/*`, applying import rewriting on-the-fly.
- **Import Rewriter:** Applies six strategies to resolve imports: relative paths, React library, veryfront internals, path aliases, npm packages via CDN, and cross-project registry URLs.
