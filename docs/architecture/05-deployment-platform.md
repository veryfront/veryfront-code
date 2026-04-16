# Deployment Platform Architecture

`veryfront-code` is the open core of the Veryfront platform. Veryfront Cloud is the primary managed deployment path, and the same runtime can also be self-hosted or deployed to other cloud environments. The runtime adapter pattern abstracts away platform differences, and the build system produces portable deployment artifacts.

---

## Runtime Adapter Architecture

```mermaid
graph TB
    subgraph Detection["Runtime Detection"]
        Detect["detectRuntime()<br/>Check global objects"]
        DenoCheck["typeof Deno !== 'undefined'"]
        BunCheck["typeof Bun !== 'undefined'"]
        NodeCheck["process.versions?.node"]
        CFCheck["typeof caches !== 'undefined'"]
    end

    subgraph AdapterInterface["RuntimeAdapter Interface"]
        Props["id: RuntimeId<br/>name: string<br/>capabilities: RuntimeCapabilities"]
        FS["fs: FileSystemAdapter"]
        Env["env: EnvironmentAdapter"]
        ServerAdpt["server: ServerAdapter"]
        Serve["serve(handler, options): Server"]
        OptShell["shell?: ShellAdapter"]
        OptKV["kv?: KVStoreAdapter"]
        OptWatch["watcher?: FileWatcherAdapter"]
        Init["initialize?(): Promise"]
        Shutdown["shutdown?(): Promise"]
    end

    subgraph Adapters["Runtime Adapters"]
        subgraph DenoAdapter["Deno Adapter"]
            DenoServe["Deno.serve()"]
            DenoFS["Deno.readFile/writeFile"]
            DenoKV["Deno.Kv (built-in KV)"]
            DenoWatch["Poll-based watcher"]
        end

        subgraph NodeAdapter["Node.js Adapter"]
            NodeServe["http.createServer()"]
            NodeFS["fs/promises"]
            NodeHTTP2["HTTP/2 support"]
            NodeWatch["fs.watch()"]
        end

        subgraph BunAdapter["Bun Adapter"]
            BunServe["Bun.serve()"]
            BunFS["Bun.file()"]
            BunTS["Native TypeScript"]
            BunWatch2["Bun.watch()"]
        end

        subgraph CFAdapter["Cloudflare Workers"]
            CFFetch["fetch handler"]
            CFKV["Cloudflare KV"]
            CFLimits["30s CPU / 128MB RAM"]
        end
    end

    Detect --> DenoCheck & BunCheck & NodeCheck & CFCheck
    DenoCheck -->|match| DenoAdapter
    BunCheck -->|match| BunAdapter
    NodeCheck -->|match| NodeAdapter
    CFCheck -->|match| CFAdapter

    AdapterInterface --> Adapters
```

### Runtime Capabilities

| Capability   | Deno | Node | Bun | Cloudflare Workers |
|--------------|------|------|-----|--------------------|
| TypeScript   | yes (1) | no | yes | no |
| HTTP/2       | no   | yes  | no  | no |
| WebSocket    | yes  | yes  | yes | yes |
| File Watch   | yes (2) | yes | yes | no |
| Shell        | yes  | yes  | yes | no |
| KV Store     | yes  | no   | no  | yes |
| Writable FS  | yes  | yes  | yes | no |

1. Deno supports TypeScript natively. Veryfront still relies on esbuild for framework transforms and bundling.
2. Deno uses poll-based file watching (manual snapshot diffing) due to platform limitations.

### Description

The `RuntimeAdapter` interface is the core abstraction that makes veryfront deployable to any environment:

- **Detection:** `detectRuntime()` checks for runtime-specific globals to determine the current platform.
- **Singleton Registry:** `AdapterRegistry` ensures exactly one adapter instance per process. Lazy loading prevents importing runtime-specific code on other platforms.
- **Capabilities:** Each adapter declares its capabilities. The framework adjusts behavior based on available features (e.g., poll-based file watching on Deno, no filesystem on Cloudflare Workers).
- **Unified Interface:** All adapters expose the same `serve(handler, options)` method that accepts a standard `Request => Response` handler. This means the same application code runs on any runtime.

---

## Deployment Targets

```mermaid
graph TB
    subgraph VfApp["Veryfront Application"]
        BuildOutput["Build Output<br/>(JS bundles, assets,<br/>manifest, service worker)"]
        ServerCode["Server Code<br/>(runtime handler)"]
    end

    subgraph Targets["Deployment Targets"]
        subgraph SelfHosted["Self-Hosted"]
            Deno["Deno<br/>deno run server.ts"]
            NodeJS["Node.js<br/>node server.js"]
            Bun["Bun<br/>bun server.ts"]
            Docker["Docker<br/>(any base image)"]
            K8s["Kubernetes<br/>(any cluster)"]
        end

        subgraph CloudProviders["Cloud Providers"]
            AWS["AWS<br/>(EC2, ECS, Lambda)"]
            GCP["Google Cloud<br/>(Cloud Run, GKE)"]
            Azure["Azure<br/>(App Service, AKS)"]
            DigitalOcean["DigitalOcean<br/>(App Platform)"]
            Fly["Fly.io"]
            Railway["Railway"]
        end

        subgraph Edge["Edge Platforms"]
            CF["Cloudflare Workers"]
            DenoEdge["Deno Deploy"]
        end

        subgraph Managed["Managed Platform"]
            VfCloud["Veryfront Cloud<br/>(managed deployment,<br/>releases, environments)"]
        end
    end

    subgraph VfCloudFeatures["Veryfront Cloud Extras"]
        Releases["Release Management<br/>(branch → release → deploy)"]
        Environments["Environments<br/>(preview, production)"]
        VfFS["Veryfront FS<br/>(remote filesystem API)"]
        ModelProxy["Model Proxy<br/>(gateway to AI providers)"]
        Analytics["Analytics & Monitoring"]
    end

    BuildOutput --> SelfHosted
    BuildOutput --> CloudProviders
    BuildOutput --> Edge
    ServerCode --> SelfHosted
    ServerCode --> CloudProviders
    ServerCode --> Edge

    BuildOutput --> VfCloud
    ServerCode --> VfCloud
    VfCloud --> VfCloudFeatures
```

### Description

Veryfront produces standard deployment artifacts that work across managed and self-hosted environments:

- **Veryfront Cloud:** The primary managed deployment path. It adds release management (branch → release → deploy), preview/production environments, a remote filesystem API, AI model proxy gateway, and platform operations on top of the open-core runtime.
- **Self-Hosted:** Run directly with `deno run`, `node`, or `bun`. Package in Docker containers for any container orchestration platform (Kubernetes, Docker Compose, etc.).
- **Other Cloud Providers:** Use the same build/runtime outputs on cloud providers that run containers or Node.js/Deno/Bun applications -- AWS (EC2, ECS, Lambda), Google Cloud (Cloud Run, GKE), Azure (App Service, AKS), DigitalOcean, Fly.io, Railway, etc.
- **Edge Platforms:** Deploy to Cloudflare Workers or Deno Deploy for edge execution with the Cloudflare adapter when that runtime model fits.

The intent is straightforward: Veryfront Cloud is the primary managed path, but the open core stays portable and avoids deployment lock-in.

---

## Virtual Filesystem Resolution

The filesystem abstraction allows reading project files from multiple sources, enabling both local development and cloud-hosted projects.

```mermaid
flowchart TD
    subgraph Config["Configuration Sources (Priority Order)"]
        ReqCtx["1. Request Context<br/>(per-request headers<br/>in multi-project proxy mode)"]
        ScopedCtx["2. Scoped Context<br/>(AsyncLocalStorage)"]
        EnvVars["3. Environment Variables<br/>(VERYFRONT_API_TOKEN,<br/>VERYFRONT_PROJECT_SLUG)"]
        RuntimeCfg["4. Runtime Config<br/>(veryfront.config.ts:<br/>fs.veryfront.apiToken)"]
    end

    subgraph CloudDecision["Cloud Enable Decision"]
        ServiceLayer{"serviceLayer?"}
        LocalMode["'local' → bypass cloud"]
        CloudMode["'cloud' → require token"]
        AutoDetect{"Auto-detect:<br/>token + project context?"}
        Enabled["Cloud FS Enabled"]
        Disabled["Local FS Only"]
    end

    subgraph FSFactory["FSAdapter Factory"]
        TypeCheck{"config.type?"}
        LocalFS["Local FS<br/>(RuntimeAdapter.fs)"]
        VfAPI["Veryfront API FS"]
        GitHubAPI["GitHub API FS"]

        ProxyCheck{"proxyMode?"}
        SingleProject["VeryfrontFSAdapter<br/>(single project)"]
        MultiProject["MultiProjectFSAdapter<br/>(per-request project)"]
    end

    subgraph VfFSDetail["Veryfront FS Internals"]
        APIClient["Veryfront API Client<br/>(retry + backoff)"]
        FileCache["File Cache<br/>(100MB, 1000 entries, 60s TTL)"]
        WSManager["WebSocket Manager<br/>(real-time cache invalidation)"]
        ContentCtx["Content Source Resolution<br/>(branch / environment / release)"]
    end

    subgraph GitHubFSDetail["GitHub FS Internals"]
        GHClient["GitHub API Client<br/>(pagination + rate limits)"]
        TreeIndex["Tree-Based Index<br/>(efficient directory listing)"]
        GHCache["File Cache<br/>(configurable retry)"]
        RefSpec["Ref Specification<br/>(branch / tag / SHA)"]
    end

    Config --> CloudDecision
    ServiceLayer -->|"local"| LocalMode --> Disabled
    ServiceLayer -->|"cloud"| CloudMode --> Enabled
    ServiceLayer -->|undefined| AutoDetect
    AutoDetect -->|yes| Enabled
    AutoDetect -->|no| Disabled

    Enabled --> FSFactory
    Disabled --> LocalFS

    TypeCheck -->|"local"| LocalFS
    TypeCheck -->|"veryfront-api"| VfAPI
    TypeCheck -->|"github"| GitHubAPI

    VfAPI --> ProxyCheck
    ProxyCheck -->|false| SingleProject --> VfFSDetail
    ProxyCheck -->|true| MultiProject --> VfFSDetail

    GitHubAPI --> GitHubFSDetail
```

### Description

Filesystem resolution follows a layered decision process:

1. **Configuration Priority:** Request context (for multi-project proxy mode) > scoped context (AsyncLocalStorage) > environment variables > runtime config.
2. **Cloud Enable Decision:** The `serviceLayer` setting determines the mode -- `"local"` bypasses cloud entirely, `"cloud"` requires an API token, and auto-detect enables cloud when both a token and project context are present.
3. **Adapter Selection:** Three adapter types -- local filesystem (direct runtime access), Veryfront API (remote project files), and GitHub API (repository files).
4. **Veryfront FS:** Uses an API client with retry/backoff, a file cache (100MB, 1000 entries, 60s TTL), WebSocket-based real-time cache invalidation, and content source resolution (read from a specific branch, environment, or release).
5. **GitHub FS:** Uses the GitHub API with pagination and rate limit handling, tree-based indexing for efficient directory listing, and ref specification for reading specific branches/tags.
6. **Multi-Project Mode:** The `MultiProjectFSAdapter` supports per-request project scoping via `runWithContext()`, enabling a single server to serve multiple projects (proxy mode).

---

## Build Pipeline

```mermaid
flowchart TD
    subgraph Input["Source Input"]
        Pages["Pages<br/>(app/**/page.*<br/>or pages/**)"]
        APIRoutes["API Routes<br/>(app/api/**/route.*<br/>or pages/api/**)"]
        Components["Components<br/>(src/components/**/*.tsx)"]
        MDXFiles["MDX Files<br/>(*.mdx)"]
        Styles["Styles<br/>(CSS, Tailwind)"]
        Assets["Assets<br/>(images, fonts)"]
    end

    subgraph BuildStages["Build Stages"]
        RouteCollect["1. Route Collection<br/>(discover pages + API routes)"]
        MDXCompile["2. MDX Compilation<br/>(MDX → React components)"]
        TSCompile["3. TypeScript Compilation<br/>(esbuild transform)"]
        CodeSplit["4. Code Splitting<br/>(per-route chunks + shared)"]
        CSSOptimize["5. CSS Optimization<br/>(Lightning CSS + Tailwind)"]
        ImageOptimize["6. Image Optimization<br/>(Sharp integration)"]
        SSG["7. Static Generation<br/>(render static routes)"]
        Manifest["8. Manifest Generation<br/>(route → chunk mapping)"]
        SW["9. Service Worker<br/>(offline + asset caching)"]
    end

    subgraph Output["Build Output"]
        JSBundles["JS Bundles<br/>(route chunks + shared chunks)"]
        CSSBundles["CSS Bundles<br/>(optimized + purged)"]
        StaticHTML["Static HTML<br/>(pre-rendered pages)"]
        AssetFiles["Optimized Assets<br/>(compressed images)"]
        BuildManifest["Build Manifest v2.0<br/>{routes, chunks, features, stats}"]
        ServiceWorker["Service Worker<br/>(cache strategies)"]
    end

    subgraph CLIFlags["CLI Configuration"]
        SplitFlag["--split (code splitting)"]
        CompressFlag["--compress (minification)"]
        PrefetchFlag["--prefetch (link prefetching)"]
        SSGFlag["--ssg / --no-ssg"]
        IncludeFlag["--include (route patterns)"]
        ExcludeFlag["--exclude (route patterns)"]
        OutputFlag["--output (output directory)"]
        PresetFlag["--preset embedded<br/>(Deno compile bundle)"]
    end

    Input --> BuildStages
    BuildStages --> Output
    CLIFlags -.-> BuildStages
```

### Description

The build pipeline transforms source code into production-ready artifacts:

1. **Route Collection:** Discovers page routes and API routes from both supported router modes. The active mode is controlled by `veryfront.config.ts` (`router: "app" | "pages"`), with fallback behavior when only one directory is present.
2. **MDX Compilation:** Transforms MDX files into React components with plugin support and frontmatter extraction.
3. **TypeScript Compilation:** Uses esbuild for fast TypeScript/JSX compilation.
4. **Code Splitting:** Generates per-route chunks and shared chunks for optimal loading. Tree shaking removes unused code.
5. **CSS Optimization:** Lightning CSS for minification and autoprefixing. Tailwind CSS processing with purging.
6. **Image Optimization:** Sharp integration for image compression and format conversion.
7. **Static Generation:** Pre-renders routes that use `getStaticPaths()` into static HTML.
8. **Manifest Generation:** Produces a `BuildManifest` (v2.0) mapping routes to their chunks, enabling the client runtime to load only the code needed for each page.
9. **Service Worker:** Generates a service worker for offline support and asset caching.

The `--preset embedded` flag produces a Deno-compiled bundle with all dependencies included.

---

## Veryfront Cloud Release and Deployment Flow

When deploying to Veryfront Cloud, the current CLI flow is release-and-deploy orchestration against the Veryfront API:

```mermaid
sequenceDiagram
    participant Dev as Developer
    participant CLI as veryfront CLI
    participant API as Veryfront Cloud API

    Dev->>CLI: veryfront deploy --branch main --env production

    CLI->>API: GET /projects/{slug}/environments<br/>Find environment by name
    API-->>CLI: {id: "env-1", name: "production", ...}

    CLI->>API: POST /projects/{slug}/releases<br/>{branch: "main", name: "v1.2.3"}
    API-->>CLI: {id: "rel-1", status: "pending"}

    CLI->>API: POST /projects/{slug}/deployments<br/>{releaseId: "rel-1", environmentId: "env-1"}
    API-->>CLI: {id: "dep-1", status: "pending"}
    API-->>CLI: deployment accepted
    CLI-->>Dev: Release created and deployment started
```

### Description

The current CLI-managed flow is:

1. **Resolve Environment:** `veryfront deploy` looks up the named environment through `/projects/{slug}/environments`.
2. **Create Release:** The CLI creates a release from the requested branch through `/projects/{slug}/releases`.
3. **Create Deployment:** The CLI creates a deployment linking that release to the target environment through `/projects/{slug}/deployments`.

After that, the platform continues the managed deployment workflow. The current CLI implementation does not document or expose a full build-status polling loop in this command, so this architecture page should stay grounded on the API interactions it actually performs.

For other cloud providers, developers use the standard build output with their preferred deployment tools.

---

## Current Deployment CLI Surfaces

The current deployment-related CLI surface is:

```mermaid
graph LR
    subgraph Current["Implemented Commands"]
        Init["veryfront init<br/>(scaffold project)"]
        Push["veryfront push<br/>(upload local files to Veryfront branch)"]
        Build["veryfront build<br/>(production build)"]
        Deploy["veryfront deploy<br/>(create release + deployment)"]
        Up["veryfront up<br/>(login/create/push/deploy)"]
        Open["veryfront open<br/>(open Studio or environment URL)"]
    end
```

### Description

These commands are implemented today and are the ones this documentation should treat as current:

- **`veryfront init`:** Scaffold a project locally and optionally connect it to Veryfront.
- **`veryfront push`:** Upload local files to a Veryfront branch and share preview work.
- **`veryfront build`:** Produce the portable production build output.
- **`veryfront deploy`:** Create a release from a branch and deploy it to a named environment.
- **`veryfront up`:** Run the higher-level login/create/push/deploy flow.
- **`veryfront open`:** Open Studio or a project environment URL in the browser.

Operational commands such as environment-variable management, rollback, or deployment-log streaming should not be documented here as current CLI surfaces unless they are actually implemented.
