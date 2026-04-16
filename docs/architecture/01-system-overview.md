# System Overview

## High-Level Architecture

Veryfront is a full-stack TypeScript framework that combines web rendering (SSR/RSC/SSG), an AI agent system, and multi-runtime deployment into a single cohesive platform. It can be deployed to **any cloud provider** via runtime adapters -- not just Veryfront Cloud.

```mermaid
graph TB
    subgraph Clients["Clients"]
        Browser["Browser"]
        MobileApp["Mobile App"]
        AIClient["AI / MCP Client"]
        CLI["CLI Tools"]
    end

    subgraph Veryfront["Veryfront Framework"]
        subgraph EntryPoints["Entry Points"]
            DevServer["Dev Server<br/>(HMR + Fast Refresh)"]
            ProdServer["Production Server<br/>(Streaming SSR)"]
            CLICmd["CLI Commands<br/>(dev, build, deploy)"]
        end

        subgraph Core["Core Systems"]
            Router["Router<br/>(File-based + API routes)"]
            Middleware["Middleware Pipeline<br/>(Auth, CORS, Rate Limit, CSP)"]
            Rendering["Rendering Engine<br/>(SSR / RSC / SSG / Streaming)"]
            DataLayer["Data Layer<br/>(getServerData, caching)"]
        end

        subgraph AI["AI / Agent System"]
            AgentRT["Agent Runtime<br/>(multi-step, streaming)"]
            Tools["Tool Registry<br/>(Zod schemas)"]
            Workflows["Workflow Engine<br/>(DAG execution)"]
            Providers["Provider System<br/>(OpenAI, Anthropic, Google)"]
            Embedding["Embedding / RAG<br/>(vector search)"]
        end

        subgraph MCP["MCP Servers"]
            AppMCP["App MCP Server<br/>(tools, resources, prompts)"]
            VfMCP["Veryfront MCP<br/>(internal agents, AgUI)"]
        end

        subgraph Platform["Platform Layer"]
            Adapters["Runtime Adapters<br/>(Deno, Node, Bun, CF Workers)"]
            FS["Virtual Filesystems<br/>(Local, Veryfront API, GitHub)"]
            Build["Build System<br/>(esbuild, code splitting, SSG)"]
            Discovery["Discovery Engine<br/>(auto-find tools, agents, workflows)"]
        end

        subgraph CrossCutting["Cross-Cutting"]
            Security["Security<br/>(validation, CSRF, injection protection)"]
            Observability["Observability<br/>(OpenTelemetry tracing + metrics)"]
            Cache["Cache System<br/>(memory, Redis, file, distributed)"]
            Extensions["Extension System<br/>(contracts, DI, capabilities)"]
        end
    end

    subgraph Deploy["Deployment Targets"]
        VfCloud["Veryfront Cloud"]
        AWS["AWS / Lambda"]
        GCP["Google Cloud"]
        Azure["Azure"]
        Cloudflare["Cloudflare Workers"]
        Docker["Docker / K8s"]
        SelfHost["Self-Hosted<br/>(any Node/Deno/Bun server)"]
    end

    Browser --> ProdServer
    MobileApp --> ProdServer
    AIClient --> AppMCP
    AIClient --> VfMCP
    CLI --> CLICmd

    EntryPoints --> Core
    Core --> AI
    Core --> Platform
    AI --> MCP
    AI --> Platform
    MCP --> AI

    Platform --> Deploy

    CrossCutting -.-> Core
    CrossCutting -.-> AI
    CrossCutting -.-> Platform
```

### Description

The diagram shows veryfront's layered architecture:

- **Entry Points** are how users interact with the framework: dev server with HMR for development, production server for deployment, and CLI commands for build/deploy operations.
- **Core Systems** handle traditional web framework responsibilities: routing, middleware, rendering, and data fetching.
- **AI / Agent System** provides a complete AI development platform with agents, tools, workflows, model providers, and RAG -- all discoverable at startup.
- **MCP Servers** expose AI primitives via the Model Context Protocol. "App MCP" lets user applications expose tools/resources/prompts to MCP clients. "Veryfront MCP" provides internal platform agents with AgUI streaming for studio integration.
- **Platform Layer** abstracts away the runtime and deployment target. Runtime adapters support Deno, Node.js, Bun, and Cloudflare Workers. Virtual filesystems allow reading project files from local disk, Veryfront API, or GitHub.
- **Cross-Cutting Concerns** (security, observability, caching, extensions) are wired throughout all layers.
- **Deployment Targets** are any cloud provider or self-hosted environment -- the adapter pattern means veryfront is not locked to Veryfront Cloud.

---

## Module Dependency Layers

The codebase is organized into strict dependency layers. Lower layers never import from higher layers.

```mermaid
graph BT
    subgraph L0["Layer 0: Foundation"]
        types["types/"]
        config["config/"]
        utils["utils/"]
        errors["errors/"]
        platform_core["platform/<br/>(adapters, runtime detection)"]
    end

    subgraph L1["Layer 1: Infrastructure"]
        security["security/<br/>(validation, CORS, CSP)"]
        routing["routing/<br/>(route matching, API routes)"]
        middleware["middleware/<br/>(composable pipeline)"]
        cache_mod["cache/<br/>(memory, Redis, file)"]
    end

    subgraph L2["Layer 2: Module System"]
        modules["modules/<br/>(component registry, import maps)"]
        transforms["transforms/<br/>(ESM, MDX, import rewriting)"]
    end

    subgraph L3["Layer 3: Features"]
        data["data/<br/>(getServerData, getStaticPaths)"]
        html["html/<br/>(shell, metadata, hydration)"]
        react["react/<br/>(components, hooks, compat)"]
        rendering["rendering/<br/>(SSR, RSC, streaming, layouts)"]
    end

    subgraph L4["Layer 4: AI Primitives"]
        tool["tool/<br/>(definition, registry, remote MCP)"]
        prompt["prompt/<br/>(templates, variable interpolation)"]
        resource["resource/<br/>(MCP resources, subscriptions)"]
        embedding["embedding/<br/>(vectors, RAG, BM25)"]
        skill["skill/<br/>(markdown skills, allowed tools)"]
        provider["provider/<br/>(model registry, cloud proxy)"]
    end

    subgraph L5["Layer 5: AI Orchestration"]
        agent["agent/<br/>(runtime, memory, composition)"]
        workflow["workflow/<br/>(DAG executor, backends)"]
        mcp["mcp/<br/>(MCP server, sessions, tasks)"]
        chat["chat/<br/>(protocol, AgUI, streaming)"]
        discovery["discovery/<br/>(auto-registration)"]
    end

    subgraph L6["Layer 6: Orchestrators"]
        server["server/<br/>(dev, production, HMR)"]
        proxy["proxy/<br/>(multi-project routing)"]
        build["build/<br/>(production builds, SSG)"]
        cli["cli/<br/>(dev, build, deploy commands)"]
        internal_agents["internal-agents/<br/>(studio agents, AgUI bridge)"]
    end

    L1 --> L0
    L2 --> L1
    L2 --> L0
    L3 --> L2
    L3 --> L1
    L3 --> L0
    L4 --> L0
    L5 --> L4
    L5 --> L0
    L6 --> L5
    L6 --> L3
    L6 --> L1
    L6 --> L0
```

### Description

The layer architecture enforces a strict dependency direction (bottom-up only):

- **Layer 0 (Foundation):** Zero-dependency modules providing types, configuration, utilities, error handling, and platform abstraction. Every other layer can import from here.
- **Layer 1 (Infrastructure):** Security, routing, middleware, and caching -- depends only on foundation.
- **Layer 2 (Module System):** Component registry, import maps, and code transforms (ESM, MDX, import rewriting). Depends on infrastructure for path resolution and caching.
- **Layer 3 (Features):** The web rendering stack -- data fetching, HTML generation, React integration, and the SSR/RSC/streaming engine.
- **Layer 4 (AI Primitives):** Individual AI building blocks -- tools, prompts, resources, embeddings, skills, and model providers. These are self-contained and depend only on foundation.
- **Layer 5 (AI Orchestration):** Combines primitives into higher-level constructs -- agents (with memory and composition), workflow DAG execution, MCP server, chat protocol, and the discovery engine.
- **Layer 6 (Orchestrators):** Top-level entry points that wire everything together -- servers, proxy, build system, CLI, and internal agents.

All internal imports use `#veryfront/*` hash aliases. Circular dependencies are prohibited.

---

## Source Directory Map

```mermaid
graph LR
    subgraph src["src/"]
        subgraph web["Web Framework"]
            server_d["server/"]
            routing_d["routing/"]
            middleware_d["middleware/"]
            rendering_d["rendering/"]
            html_d["html/"]
            react_d["react/"]
            data_d["data/"]
            modules_d["modules/"]
            transforms_d["transforms/"]
        end

        subgraph ai["AI Platform"]
            agent_d["agent/"]
            tool_d["tool/"]
            workflow_d["workflow/"]
            prompt_d["prompt/"]
            resource_d["resource/"]
            embedding_d["embedding/"]
            skill_d["skill/"]
            provider_d["provider/"]
            mcp_d["mcp/"]
            chat_d["chat/"]
            discovery_d["discovery/"]
            internal_d["internal-agents/"]
        end

        subgraph infra["Infrastructure"]
            platform_d["platform/"]
            build_d["build/"]
            cli_d["cli/"]
            config_d["config/"]
            cache_d["cache/"]
            security_d["security/"]
            oauth_d["oauth/"]
            observability_d["observability/"]
            extensions_d["extensions/"]
        end

        subgraph shared["Shared"]
            types_d["types/"]
            utils_d["utils/"]
            errors_d["errors/"]
            proxy_d["proxy/"]
            jobs_d["jobs/"]
            repositories_d["repositories/"]
        end
    end
```

### Description

The `src/` directory is organized into four functional groups:

- **Web Framework:** Traditional full-stack web concerns -- server, routing, middleware, rendering (SSR/RSC/SSG), HTML generation, React integration, data fetching, module system, and code transforms.
- **AI Platform:** The AI development platform -- agents, tools, workflows, prompts, resources, embeddings, skills, model providers, MCP server, chat protocol, discovery engine, and internal studio agents.
- **Infrastructure:** Platform abstraction, build system, CLI, configuration, caching, security, OAuth, observability (OpenTelemetry), and the extension system.
- **Shared:** Cross-cutting types, utilities, error definitions, proxy (multi-project), background jobs, and data repositories.
