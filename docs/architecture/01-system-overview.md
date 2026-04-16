# System Overview

## High-Level Architecture

Veryfront Code is a full-stack TypeScript app framework that combines rendering (SSR/RSC/SSG), AI capabilities, and multi-runtime deployment. It is the open core of the Veryfront platform. AI is part of the core framework model, not a separate addon layer. Veryfront Cloud is the primary managed path, and the same runtime can also be self-hosted or deployed to other cloud environments.

```mermaid
graph TB
    subgraph Clients["Clients"]
        Browser["Browser"]
        MobileApp["Mobile App"]
        MCPClient["MCP Client"]
        Studio["Veryfront Studio"]
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

        subgraph AI["AI Capabilities"]
            AgentRT["Agent Runtime<br/>(multi-step, streaming)"]
            Tools["Tool Registry<br/>(Zod schemas)"]
            Workflows["Workflow Engine<br/>(DAG execution)"]
            Providers["Provider System<br/>(local, Veryfront Cloud,<br/>OpenAI, Anthropic, Google)"]
            Embedding["Embedding / RAG<br/>(vector search)"]
        end

        subgraph Integration["Integration Surfaces"]
            AppMCP["App MCP Server<br/>(tools, resources, prompts)"]
            InternalAgUi["Internal AG-UI Transport<br/>(Studio / internal agents)"]
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
    MCPClient --> AppMCP
    Studio --> InternalAgUi
    CLI --> CLICmd

    EntryPoints --> Core
    Core --> AI
    Core --> Platform
    AI --> Integration
    AI --> Platform
    Integration --> AI

    Platform --> Deploy

    CrossCutting -.-> Core
    CrossCutting -.-> AI
    CrossCutting -.-> Platform
```

### Description

The diagram shows veryfront's layered architecture:

- **Entry Points** are how users interact with the framework: dev server with HMR for development, production server for deployment, and CLI commands for build/deploy operations.
- **Core Systems** handle traditional app framework responsibilities: routing, middleware, rendering, and data fetching.
- **AI Capabilities** include agents, tools, workflows, model providers, and RAG as native framework capabilities.
- **Integration Surfaces** include the App MCP server for exposing tools/resources/prompts to MCP clients, plus a separate internal AG-UI transport used by Veryfront Studio and internal agent control-plane flows. These are related but distinct surfaces.
- **Platform Layer** abstracts away the runtime and deployment target. Runtime adapters support Deno, Node.js, Bun, and Cloudflare Workers. Virtual filesystems allow reading project files from local disk, Veryfront API, or GitHub.
- **Cross-Cutting Concerns** (security, observability, caching, extensions) are wired throughout all layers.
- **Deployment Targets** are centered on Veryfront Cloud as the primary managed path, while the open-core runtime/build layer also supports self-hosted and other cloud deployments without provider lock-in.

---

## Architectural Domains and Bridges

The codebase is better described as a set of native domains plus explicit bridge modules than as a perfectly strict layer stack.

This is intentional: AI is native to the framework, not bolted on, and some modules exist specifically to connect domains. The useful rule is preferred dependency direction, not a fake-clean claim that lower layers never import upward.

```mermaid
graph TB
    subgraph Shared["Shared Contracts and Utilities"]
        types["types/"]
        config["config/"]
        utils["utils/"]
        errors["errors/"]
    end

    subgraph Platform["Platform and Runtime"]
        platform["platform/<br/>(adapters, compat, FS, cloud bootstrap)"]
        security["security/"]
        cache_mod["cache/"]
        oauth["oauth/"]
        observability["observability/"]
        extensions["extensions/"]
    end

    subgraph App["App Framework"]
        routing["routing/"]
        middleware["middleware/"]
        modules["modules/"]
        transforms["transforms/"]
        data["data/"]
        html["html/"]
        react["react/"]
        rendering["rendering/"]
    end

        subgraph AI["AI Capabilities"]
        tool["tool/"]
        prompt["prompt/"]
        resource["resource/"]
        embedding["embedding/"]
        skill["skill/"]
        provider["provider/"]
        agent["agent/"]
        workflow["workflow/"]
        mcp["mcp/"]
    end

    subgraph Bridges["Bridge and Facade Modules"]
        chat["chat/<br/>(UI + agent streaming facade)"]
        discovery["discovery/<br/>(bootstrap across registries)"]
        internal_agents["internal-agents/<br/>(Studio AG-UI bridge)"]
    end

    subgraph Entrypoints["Entrypoints and Orchestrators"]
        server["server/"]
        build["build/"]
        proxy["proxy/"]
        cli["cli/"]
        jobs["jobs/"]
    end

    Shared --> Platform
    Shared --> App
    Shared --> AI
    Platform --> App
    Platform --> AI
    App <--> AI
    App --> Bridges
    AI --> Bridges
    Platform --> Bridges
    App --> Entrypoints
    AI --> Entrypoints
    Platform --> Entrypoints
    Bridges --> Entrypoints
```

### Description

This model reflects the current architecture more accurately:

- **Shared Contracts and Utilities:** `types/`, `config/`, `utils/`, and `errors/` provide the common language of the framework.
- **Platform and Runtime:** `platform/`, security, cache, OAuth, observability, and extension plumbing support portability, runtime capabilities, and platform-aware integration. This area is foundational, but not purely low-level in every file.
- **App Framework:** Rendering, routing, middleware, module loading, transforms, data, HTML, and React form the core application runtime.
- **AI Capabilities:** Tools, prompts, resources, embeddings, skills, providers, agents, workflows, and MCP are native framework capabilities, not optional add-ons.
- **Bridge and Facade Modules:** `chat/`, `discovery/`, and internal AG-UI surfaces intentionally span multiple domains. They should be treated as explicit bridges, kept thin, and documented as such.
- **Entrypoints and Orchestrators:** `server/`, `build/`, `proxy/`, `cli/`, and related operational surfaces wire the system together for runtime, build, and operator workflows.

Preferred dependency direction:

- shared contracts should stay broadly reusable,
- platform/runtime code should avoid unnecessary reach into higher-level domains,
- bridge modules are allowed to cross boundaries when that is their explicit job,
- and entrypoints/orchestrators should compose domains rather than become hidden owners of them.

This is a better description of the current codebase than a strict clean-layer claim. If the project later adds real dependency-boundary enforcement, the diagrams can become stricter too.

---

## Source Directory Map

```mermaid
graph LR
    subgraph src["src/"]
        subgraph shared["Shared Contracts and Utilities"]
            types_d["types/"]
            config_d["config/"]
            utils_d["utils/"]
            errors_d["errors/"]
            repositories_d["repositories/"]
        end

        subgraph platform_group["Platform and Runtime"]
            platform_d["platform/"]
            cache_d["cache/"]
            security_d["security/"]
            oauth_d["oauth/"]
            observability_d["observability/"]
            extensions_d["extensions/"]
        end

        subgraph app["App Framework"]
            routing_d["routing/"]
            middleware_d["middleware/"]
            rendering_d["rendering/"]
            html_d["html/"]
            react_d["react/"]
            data_d["data/"]
            modules_d["modules/"]
            transforms_d["transforms/"]
        end

        subgraph ai["AI Capabilities"]
            agent_d["agent/"]
            tool_d["tool/"]
            workflow_d["workflow/"]
            prompt_d["prompt/"]
            resource_d["resource/"]
            embedding_d["embedding/"]
            skill_d["skill/"]
            provider_d["provider/"]
            mcp_d["mcp/"]
        end

        subgraph bridges["Bridge and Facade Modules"]
            chat_d["chat/"]
            discovery_d["discovery/"]
            internal_d["internal-agents/"]
        end

        subgraph entrypoints["Entrypoints and Orchestrators"]
            server_d["server/"]
            build_d["build/"]
            cli_d["cli/"]
            proxy_d["proxy/"]
            jobs_d["jobs/"]
        end
    end
```

### Description

The `src/` directory is better understood as six functional groups:

- **Shared Contracts and Utilities:** `types/`, `config/`, `utils/`, `errors/`, and repository abstractions provide common contracts and reusable primitives.
- **Platform and Runtime:** `platform/`, cache, security, OAuth, observability, and extensions support runtime portability, framework infrastructure, and platform-aware integration.
- **App Framework:** Routing, middleware, rendering (SSR/RSC/SSG), HTML generation, React integration, data fetching, module loading, and transforms form the application runtime.
- **AI Capabilities:** Agents, tools, workflows, prompts, resources, embeddings, skills, providers, and MCP are native framework capabilities.
- **Bridge and Facade Modules:** `chat/`, `discovery/`, and `internal-agents/` intentionally connect multiple domains and should be treated as explicit cross-domain surfaces.
- **Entrypoints and Orchestrators:** `server/`, `build/`, `cli/`, `proxy/`, and `jobs/` wire the rest of the system together for runtime, build, operational, and multi-project workflows.

These groups describe the codebase more accurately than a strict layered stack. Some modules are intentionally cross-domain, and those should be documented as bridges rather than treated as accidental violations.
