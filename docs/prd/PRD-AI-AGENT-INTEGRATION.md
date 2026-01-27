# PRD: AI Agent Integration for Veryfront CLI

**Status**: Draft
**Author**: AI-assisted (Claude)
**Date**: 2026-01-27
**Version**: 1.1
**Priority**: P0

---

## 1. Executive Summary

This PRD defines the strategy for deeply integrating AI coding agents into the Veryfront CLI, giving them full access to project data, runtime information, logs, and the complete software development lifecycle (SDLC). The goal is to make Veryfront the most AI-agent-friendly framework by enabling any coding agent (Claude Code, Codex CLI, Gemini CLI, Cursor, Windsurf, Cline) to understand and operate on Veryfront projects with the same depth as a human developer.

**Key value proposition**: Veryfront developers get AI agents that don't just read files -- they understand project structure, see live errors, query production logs, trigger deployments, and manage the full lifecycle from planning to monitoring.

**Architecture recommendation**: A **federated dual-MCP** approach -- the Renderer MCP server handles local dev-time data (errors, logs, HMR, tests, git) while the existing API MCP server (`veryfront-api`) handles platform operations (projects, files, branches, releases, deployments). An embedded CLI agent connects to both for the first-class experience. External agents connect to both servers natively.

---

## 2. Problem Statement

### 2.1 Current State

Veryfront already has significant AI infrastructure across **two services**:

**Renderer (`veryfront-renderer`):**
- **MCP Dev Server** (`src/cli/mcp/server.ts`): 25+ tools via stdio and HTTP transport -- project context, route discovery, scaffolding, error tracking, log access, HMR control, flywheel status.
- **Agent Runtime** (`src/agent/`): Full agent framework with multi-model support (Anthropic, OpenAI, Google), tool calling, streaming, memory management, and middleware.
- **Workflow Engine** (`src/workflow/`): Durable DAG-based workflows with checkpointing, approval gates, and multiple backends.
- **Dev Dashboard** (`src/server/handlers/dev/dashboard/`): REST API with 15+ endpoints for server introspection.
- **Observability** (`src/observability/`): OpenTelemetry tracing, metrics, auto-instrumentation.

**API (`veryfront-api`):**
- **MCP Platform Server** (`src/api/http/mcp/handler.ts`): **50+ tools** across 19 tool groups via Streamable HTTP (official `@modelcontextprotocol/sdk`) -- projects, files, branches, releases, deployments, environments, domains, search, members, API keys, cache, subscriptions, uploads, integrations, favorites, templates, resources, images, user.
- **Authentication**: JWT + API keys with scope-based access control (read, write, delete).
- **Data Layer**: PostgreSQL (Drizzle ORM) + Redis, with full versioning, vector embeddings, and branch management.
- **Transport**: Stateless Streamable HTTP at `/mcp` endpoint.

### 2.2 Gaps

Despite this foundation, the two MCP servers are **disconnected** and several gaps remain:

| Gap | Impact | Affected Phase |
|-----|--------|---------------|
| **Two MCP servers not federated** | Agents must configure both separately; no unified experience | All phases |
| **No production log access via MCP** | Agents can't debug production issues without manual log copy-paste | Monitoring |
| **No test runner integration** | Agents can't run or analyze test results programmatically | Testing |
| **No local git/VCS tools** | Agents must shell out for version control operations | Coding |
| **MCP server lacks production context** | Only dev server data exposed; no production metrics, traces, or health | Monitoring |
| **No agent orchestration from CLI** | Can't run embedded agent sessions from the CLI itself | All phases |
| **No AGENTS.md support** | Missing the cross-agent standard context file | All phases |
| **Dev Dashboard not exposed to MCP** | 15+ dashboard endpoints exist but aren't available as MCP tools/resources | Debugging |
| **API MCP not discoverable from CLI** | CLI doesn't know about the API MCP server or how to connect agents to it | All phases |

### 2.3 User Pain Points

1. **Context switching**: Developers switch between CLI, browser (logs/metrics), and AI agent constantly. Agents can't see what developers see.
2. **Repetitive context injection**: Developers manually paste error messages, log snippets, and config into agent prompts.
3. **No autonomous debugging**: Agents can't observe production behavior, correlate errors with code, and suggest fixes in a closed loop.
4. **Framework-specific knowledge gap**: Generic AI agents don't understand Veryfront conventions, file-based routing, or the rendering pipeline without extensive prompting.

---

## 3. Goals & Metrics

### 3.1 Goals (Priority-ordered)

| ID | Priority | Goal | Success Metric |
|----|----------|------|---------------|
| G1 | P0 | Renderer MCP works standalone (no dev server required) | `deno task mcp` starts and serves tools without `deno task dev` |
| G2 | P0 | Full SDLC coverage across federated MCP servers | 6/6 phases covered: renderer (code, test, debug, monitor) + API (plan, code, deploy) |
| G3 | P0 | External agents connect to both MCP servers seamlessly | `veryfront setup-agent` generates configs; 6 agents verified |
| G4 | P0 | New dev-time tools: git, testing, dashboard bridge, monitoring | 15+ new renderer MCP tools |
| G5 | P1 | Embedded CLI agent powered by Claude Agent SDK | `veryfront agent` command connects to both MCP servers |
| G6 | P1 | Production observability accessible to agents | Agents can query Loki logs, Tempo traces, and Prometheus metrics |
| G7 | P2 | Agent-driven deployment pipeline | Agents orchestrate across both servers with approval gates |
| G8 | P2 | Cross-agent standard support | AGENTS.md generated/maintained alongside CLAUDE.md |

### 3.2 Success Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Renderer MCP tool count | 25 | 40+ | New: git, testing, dashboard, monitoring tools |
| Combined tool count (renderer + API) | 75 | 90+ | Total across both federated servers |
| SDLC phase coverage | 2/6 (code, debug) | 6/6 | Phases with at least 2 tools each across both servers |
| Agent compatibility | 1 (Claude Code) | 6 | Verified agents connecting to **both** servers |
| Standalone MCP reliability | 0% (fails without dev server) | 100% | `deno task mcp` starts independently |
| Context richness | Files + errors + logs | + metrics + traces + git + tests + deploy | Data accessible across federated servers |
| Developer adoption | 0 | 50% of active Veryfront devs | Weekly active agent users |

---

## 4. Non-Goals

- **Building a new AI agent from scratch**: We use Claude Agent SDK, not a custom agent loop.
- **Replacing existing CLI commands**: Agent augments, doesn't replace, existing `veryfront build/dev/deploy` commands.
- **Multi-tenant agent hosting**: The embedded agent runs locally per developer, not as a shared service.
- **Custom model training**: We use foundation models (Claude, GPT, Gemini) via their SDKs, not fine-tuned models.
- **IDE plugin development**: We provide MCP servers that IDEs connect to; we don't build VS Code extensions.

---

## 5. User Personas

### 5.1 Solo Developer ("Alex")

- Builds Veryfront apps for clients
- Uses Claude Code as primary coding tool
- Wants: "AI that understands my Veryfront project structure and can debug production issues"
- Pain: Manually copies error logs into Claude Code prompts
- SDLC needs: Code, test, debug, deploy

### 5.2 Agency Developer ("Sam")

- Works on multiple Veryfront projects simultaneously
- Uses Cursor for IDE and occasionally Codex CLI
- Wants: "Quick context switching between projects with agent that knows each project's state"
- Pain: Re-explaining project structure to AI every session
- SDLC needs: Plan, code, test, debug

### 5.3 Platform Engineer ("Jordan")

- Maintains Veryfront infrastructure and deployments
- Uses Gemini CLI and custom scripts
- Wants: "Agent that can correlate production errors with recent deploys and suggest rollbacks"
- Pain: Manually querying Grafana, cross-referencing with git log, then debugging
- SDLC needs: Deploy, monitor, debug

---

## 6. Architecture Evaluation

### 6.1 Key Discovery: Two MCP Servers Already Exist

Before evaluating options, a critical finding: **the Veryfront API already has a production MCP server** with 50+ tools covering platform operations. This changes the architecture fundamentally.

| | Renderer MCP (local) | API MCP (remote) |
|---|---|---|
| **Location** | `veryfront-renderer/src/cli/mcp/` | `veryfront-api/src/api/http/mcp/` |
| **Transport** | stdio + custom HTTP | Streamable HTTP (official SDK) |
| **Endpoint** | `deno task mcp` / `localhost:{port+2}/mcp` | `https://api.veryfront.com/mcp` |
| **Auth** | None (localhost) | JWT / API key (scoped) |
| **SDK** | Custom JSONRPC | `@modelcontextprotocol/sdk` |
| **Tools (~75 total)** | ~25 dev-time tools | ~50 platform tools |
| **Data scope** | Local: errors, logs, HMR, routes, scaffold, flywheel | Cloud: projects, files, branches, releases, deployments, environments, search, domains, members, API keys |
| **SDLC phases** | Code, Debug | Plan, Code, Deploy |

This means **deploy, release, branch, file, environment, and project management tools already exist in the API**. The renderer should NOT rebuild these.

### 6.2 Why Not a Local MCP Bridge?

A bridge (renderer proxying API calls) was considered and rejected:

1. **Duplicates existing work** -- the API MCP server has 50 tools already built, tested, and authenticated
2. **Adds latency** -- agent → local process → API → DB vs. agent → API → DB directly
3. **Maintenance burden** -- keeping bridge in sync with API schema changes
4. **Loses auth context** -- the API's per-tool scope system validates permissions; a bridge must forward credentials anyway
5. **Breaks MCP standard** -- all major agents (Claude Code, Codex, Gemini CLI) support multiple MCP servers natively; a bridge is unnecessary abstraction

### 6.3 Option A: Federated Dual-MCP (Recommended)

**Description**: Two purpose-built MCP servers, each owning its domain. External agents connect to both. The embedded CLI agent also connects to both as in-process (local) + HTTP (remote) MCP clients.

```
┌──────────────────────────────────────────────────────────────────┐
│                     AI Coding Agent                               │
│           (Claude Code / Codex / Gemini CLI / Cursor)            │
└──────────────┬───────────────────────────────┬───────────────────┘
               │                               │
               │ MCP (stdio)                   │ MCP (Streamable HTTP)
               │                               │
               ▼                               ▼
┌──────────────────────────┐    ┌──────────────────────────────────┐
│  veryfront-dev           │    │  veryfront-api                   │
│  (Renderer MCP Server)   │    │  (API MCP Server)                │
│                          │    │                                  │
│  LOCAL DEV-TIME DATA     │    │  CLOUD PLATFORM DATA             │
│                          │    │                                  │
│  Coding:                 │    │  Planning:                       │
│  - vf_get_project_context│    │  - list_projects                 │
│  - vf_list_routes        │    │  - create_project                │
│  - vf_scaffold           │    │                                  │
│  - vf_get_conventions    │    │  Coding (cloud files):           │
│  - vf_get_component_tree │    │  - list_files, get_files         │
│  - vf_git_status    NEW  │    │  - create_file, update_file      │
│  - vf_git_diff      NEW  │    │  - move_file, delete_file        │
│  - vf_git_log        NEW │    │  - search_files (vector)         │
│                          │    │                                  │
│  Testing:           NEW  │    │  Branching:                      │
│  - vf_run_tests          │    │  - list_branches                 │
│  - vf_run_typecheck      │    │  - create_branch                 │
│  - vf_run_lint           │    │  - merge_branch                  │
│                          │    │  - get_branch_status             │
│  Debugging:              │    │                                  │
│  - vf_get_errors         │    │  Deploying:                      │
│  - vf_get_logs           │    │  - create_release                │
│  - vf_preview_route      │    │  - deploy_release                │
│  - vf_get_flywheel_status│    │  - list_deployments              │
│  - vf_get_server_stats   │    │  - create_environment            │
│  - vf_get_metrics    NEW │    │  - upsert_environment_variable   │
│  - vf_get_memory     NEW │    │  - add_domain, list_domains      │
│                          │    │                                  │
│  Monitoring:        NEW  │    │  Team:                           │
│  - vf_query_logs (Loki)  │    │  - list_members, add_member      │
│  - vf_query_traces(Tempo)│    │  - create_api_key                │
│  - vf_query_metrics      │    │                                  │
│                          │    │  Search:                         │
│  Framework:              │    │  - search_files (vector)         │
│  - vf_get_skills         │    │  - upsert_embeddings             │
│  - vf_create_project     │    │                                  │
│  - vf_trigger_hmr        │    │  + 30 more tools                 │
│  - vf_wait_for_ready     │    │                                  │
└──────────────────────────┘    └──────────────────────────────────┘
       │ localhost only                │ Authenticated (JWT/API key)
       │ No auth needed               │ Scope-checked per tool
       ▼                              ▼
┌──────────────┐            ┌──────────────────┐
│ Dev Server   │            │ PostgreSQL+Redis  │
│ File System  │            │ Kubernetes        │
│ Git (local)  │            │ Grafana Cloud     │
│ Test Runner  │            │ Stripe            │
└──────────────┘            └──────────────────┘
```

**Pros**:
- **Zero duplication**: Each server owns its data domain; no bridge needed
- **Already built**: API MCP server has 50+ tools in production today
- **Universal**: Every major agent supports multiple MCP servers natively
- **Clear boundaries**: Local (renderer) vs. cloud (API) separation matches deployment topology
- **Independent scaling**: Each server evolves independently
- **Security**: API server has proper auth + scopes; renderer stays localhost-only

**Cons**:
- Agents must configure two MCP servers (mitigated by `veryfront setup-agent` command)
- Tool naming must be clear about which server owns what
- Embedded agent needs two MCP client connections

### 6.4 Option B: Single Unified MCP (Rejected)

A single MCP server that proxies both local and remote data.

**Rejected because**:
- Duplicates 50 already-built API tools
- Bridge adds latency and maintenance
- Loses API's scope-based auth model
- Fighting the MCP ecosystem (multi-server is standard)

### 6.5 Recommendation: Option A (Federated Dual-MCP)

The federated approach is recommended because:

1. **Leverages existing investment**: The API MCP server already has 50+ tools covering projects, files, branches, releases, deployments, environments, search, members, and more. Zero work needed for platform operations.
2. **Clear domain ownership**: Renderer owns dev-time data (errors, logs, HMR, tests, git, local files). API owns platform data (cloud projects, releases, deployments, team).
3. **Standard pattern**: All major agents handle multiple MCP servers. This is how the ecosystem works.
4. **Renderer scope narrows**: Instead of building 40+ new tools, the renderer only needs ~15 new tools (git, testing, monitoring, dashboard bridge). The API already covers the rest.

### 6.6 Embedded Agent (Phase 2) on Top of Federation

The embedded `veryfront agent` command connects to both MCP servers:

```
┌─────────────────────────────────────────┐
│  veryfront agent (Claude Agent SDK)      │
│                                          │
│  ┌──────────────────────────────┐        │
│  │ In-process MCP Client        │        │
│  │                              │        │
│  │  Local tools ──► Renderer    │        │
│  │  (in-process, zero latency)  │        │
│  │                              │        │
│  │  Platform tools ──► API      │        │
│  │  (HTTP, authenticated)       │        │
│  └──────────────────────────────┘        │
│                                          │
│  + System prompt (framework knowledge)   │
│  + Persistent memory (per-project)       │
│  + Approval gates (deploy, delete)       │
│  + Hooks (pre-commit, post-deploy)       │
└──────────────────────────────────────────┘
```

This gives the embedded agent the **deepest possible integration** -- direct in-process access to dev-time data AND authenticated access to the full platform via the API MCP server.

### 6.7 Leveraging the Existing Dev Dashboard

The Dev Dashboard (`src/server/handlers/dev/dashboard/api.ts`) already exposes 15+ REST endpoints that provide exactly the data AI agents need:

| Dashboard Endpoint | Proposed MCP Tool | Data |
|---|---|---|
| `/_dev/api/stats` | `vf_get_server_stats` | Request counts, timing, cache stats |
| `/_dev/api/tools` | Already exposed | MCP tool registry |
| `/_dev/api/agents` | `vf_list_agents` | Registered agent definitions |
| `/_dev/api/workflows` | `vf_list_workflows` | Workflow definitions and state |
| `/_dev/api/handlers` | `vf_get_handler_pipeline` | Request handler chain |
| `/_dev/api/metrics` | `vf_get_metrics` | Performance metrics |
| `/_dev/api/files` | Already partially exposed | Project file listing |
| `/_dev/api/file-content` | Already exposed via remote-file-tools | File content reading |
| `/_dev/api/infrastructure` | `vf_get_infrastructure` | Runtime, platform, adapters |
| `/_dev/api/memory` | `vf_get_memory_stats` | Heap, RSS, external memory |
| `/_dev/api/build` | `vf_get_build_status` | Build state and artifacts |
| `/_dev/api/config` | `vf_get_config` | Runtime configuration |
| `/_dev/api/execute-tool` | Already exposed | Tool execution |
| `/_dev/api/reload` | `vf_force_reload` | Force server reload |

**Strategy**: Bridge dashboard endpoints to MCP tools. This is low-effort because the data layer already exists -- we just need MCP wrappers.

---

## 7. Functional Requirements

### Phase 1: Enhanced Renderer MCP + Federation (P0)

The renderer MCP server focuses on **local dev-time data only**. Platform operations (projects, files, branches, releases, deployments, environments, search, members) are already handled by the API MCP server.

#### FR-001: Renderer MCP -- New Dev-Time Tools

New tools for the renderer MCP server (local data only):

**Coding Tools** (new):

| Tool | Description | Input | Output |
|------|-------------|-------|--------|
| `vf_git_status` | Git status (staged, modified, untracked) | -- | File lists by state |
| `vf_git_diff` | View changes (staged or unstaged) | staged (boolean), file | Diff text |
| `vf_git_log` | Recent commit history | limit, branch | Commit list |
| `vf_git_branch` | List/create/switch branches | action, name | Branch info |

**Testing Tools** (new):

| Tool | Description | Input | Output |
|------|-------------|-------|--------|
| `vf_run_tests` | Execute test suite | filter, coverage | Results + failures |
| `vf_run_typecheck` | Run TypeScript type checking | -- | Errors with locations |
| `vf_run_lint` | Run linter | fix (boolean) | Lint errors |
| `vf_verify` | Run lint + typecheck + tests | -- | Combined results |

**Dashboard Bridge Tools** (new -- wrapping existing dashboard REST endpoints):

| Tool | Description | Source |
|------|-------------|--------|
| `vf_get_server_stats` | Server statistics | `/_dev/api/stats` |
| `vf_get_metrics` | Performance metrics | `/_dev/api/metrics` |
| `vf_get_memory_stats` | Memory usage | `/_dev/api/memory` |
| `vf_get_infrastructure` | Runtime info | `/_dev/api/infrastructure` |
| `vf_get_build_status` | Build state | `/_dev/api/build` |
| `vf_get_config` | Runtime config | `/_dev/api/config` |
| `vf_list_agents` | Registered agents | `/_dev/api/agents` |
| `vf_list_workflows` | Workflow definitions | `/_dev/api/workflows` |

**Monitoring Tools** (new):

| Tool | Description | Input | Output |
|------|-------------|-------|--------|
| `vf_query_prod_logs` | Query production logs (Loki) | query, timeRange, limit | Log entries |
| `vf_query_traces` | Query distributed traces (Tempo) | traceId, service, timeRange | Trace data |
| `vf_query_prod_metrics` | Query Prometheus metrics | query, timeRange | Metric series |

**Not built in renderer** (already in API MCP server):
- ~~`vf_build`~~, ~~`vf_release`~~, ~~`vf_deploy_status`~~ --> Use API's `create_release`, `deploy_release`, `list_deployments`
- ~~`vf_create_issue`~~, ~~`vf_list_issues`~~ --> Use existing file-based issues or API project management
- ~~`vf_git_branch` (cloud)~~ --> Use API's `create_branch`, `merge_branch`, `list_branches`

#### FR-002: Standalone MCP Entry Point (Dev Server Not Required)

**Critical requirement**: The renderer MCP server currently only runs when the dev server is running. This fails when agents try to connect cold (see screenshot: `veryfront` MCP shows `x failed` in Claude Code).

The MCP server must work in **two modes**:

1. **Standalone mode** (`deno task mcp`): Starts the MCP server without the dev server. Provides tools that work without a running server (git, tests, lint, project context, scaffolding, conventions, skills, file reading). Dev-server-dependent tools (errors, logs, HMR, flywheel, preview) return clear "dev server not running" messages with instructions.

2. **Attached mode** (launched by `deno task dev`): Full access to dev server internals. All tools operational.

```
# Standalone -- always works, subset of tools
deno task mcp

# Attached -- full access, started by dev server
deno task dev  # also starts MCP on port+2
```

Claude Code, Codex CLI, Gemini CLI, and Cursor configure the **standalone** entry point. When the dev server is running, the standalone process detects it and bridges to the running server for live data.

#### FR-003: Agent Setup Command

A CLI command that auto-generates MCP configuration for all supported agents:

```bash
# Auto-detect installed agents and configure both MCP servers
veryfront setup-agent

# Configure specific agent
veryfront setup-agent --agent claude-code
veryfront setup-agent --agent codex
veryfront setup-agent --agent gemini
veryfront setup-agent --agent cursor
```

This generates:
- `.mcp.json` (Claude Code) -- both `veryfront-dev` (stdio) and `veryfront-api` (HTTP)
- `~/.codex/config.toml` entries (Codex CLI)
- `~/.gemini/settings.json` entries (Gemini CLI)
- `.cursor/mcp.json` (Cursor)

Each config includes both servers:
```json
{
  "mcpServers": {
    "veryfront-dev": {
      "command": "deno",
      "args": ["task", "mcp"],
      "cwd": "/path/to/project"
    },
    "veryfront-api": {
      "type": "streamable-http",
      "url": "https://api.veryfront.com/mcp",
      "headers": { "Authorization": "Bearer ${VERYFRONT_API_TOKEN}" }
    }
  }
}
```

#### FR-004: Enhanced MCP Resources & Prompts

**Resources** (renderer MCP):

| Resource URI | Description | Data |
|---|---|---|
| `veryfront://project` | Project summary | Routes, features, config, health |
| `veryfront://errors` | Current errors | Exists |
| `veryfront://logs` | Recent logs | Exists |
| `veryfront://metrics` | Performance metrics | Request timing, cache stats |
| `veryfront://config` | Runtime configuration | Server config, env vars |
| `veryfront://git` | Git status | Branch, changes, recent commits |
| `issues://` | Project issues | Exists |

**Prompts** (renderer MCP):

| Prompt | Description |
|--------|-------------|
| `veryfront` | Build Veryfront apps (exists) |
| `flywheel` | Dev loop workflow (exists) |
| `debug-production` | **New**: Production debugging with log/trace queries |
| `review-code` | **New**: Code review with Veryfront conventions |
| `plan-feature` | **New**: Feature planning with project context |

#### FR-005: Upgrade to Official MCP SDK

Replace the custom JSONRPC implementation in `src/cli/mcp/server.ts` with `@modelcontextprotocol/sdk`:

- Use `McpServer` class (same as the API uses)
- Support Streamable HTTP transport (in addition to stdio)
- Proper capability negotiation
- Forward-compatible with MCP v2

#### FR-006: AGENTS.md Generation

- Auto-generate an `AGENTS.md` file from project context
- Include: project structure, conventions, available MCP servers (both), setup commands, testing procedures
- Update on `veryfront dev` startup if stale
- Coexist with `CLAUDE.md` (Veryfront-specific; AGENTS.md is universal)

### Phase 2: Embedded CLI Agent (P1)

#### FR-006: `veryfront agent` Command

New CLI command that launches an interactive agent session:

```bash
# Interactive mode
veryfront agent

# Single task mode
veryfront agent "debug the 500 error on /api/users"

# With specific model
veryfront agent --model claude-sonnet-4 "add dark mode support"

# Resume previous session
veryfront agent --resume
```

**Capabilities:**
- Full access to all MCP tools (in-process, no network overhead)
- Persistent memory across sessions (per-project, Redis-backed)
- System prompt with deep Veryfront framework knowledge
- Approval gates for destructive operations (deploy, delete, force push)
- Streaming output with tool use visibility

#### FR-007: Agent System Prompt

The embedded agent's system prompt includes:

- Veryfront framework architecture and conventions
- Current project context (routes, features, integrations)
- Available tools and when to use them
- SDLC workflow guidance
- Production environment details (from CLAUDE.md)
- Guardrails (never deploy without tests passing, never force push to main)

#### FR-008: Agent Memory

- **Per-project memory**: Conversations, decisions, and context persist per project
- **Session continuity**: Resume interrupted sessions
- **Context learning**: Agent remembers project-specific patterns and preferences
- **Storage**: Redis for distributed, file-based for local-only

#### FR-009: Agent Hooks

Lifecycle hooks for guardrails:

| Hook | Trigger | Purpose |
|------|---------|---------|
| `pre-deploy` | Before `vf_release` or `vf_build` | Run tests, lint, typecheck |
| `pre-commit` | Before git operations | Validate changes |
| `post-error` | After error detection | Auto-suggest fixes |
| `post-deploy` | After deployment | Health check monitoring |

#### FR-010: Agent as MCP Server

The embedded agent can expose itself as an MCP server for orchestration:

```bash
# Start agent as MCP server (for other agents to delegate to)
veryfront agent --mcp-server
```

This enables the pattern where Claude Code orchestrates the Veryfront agent as a specialized sub-agent.

### Phase 3: Production Integration (P2)

#### FR-011: Grafana Cloud Integration

MCP tools that query production observability:

- **Loki**: Log queries with LogQL
- **Tempo**: Trace queries and span analysis
- **Prometheus**: Metric queries with PromQL
- **Alerts**: Active alert status

Requires: Environment variables for Grafana Cloud credentials (already documented in CLAUDE.md).

#### FR-012: Kubernetes Integration

MCP tools for cluster operations:

- Pod status and health
- Recent deployment events
- Container log streaming
- Resource usage (CPU, memory)

Requires: KUBECONFIG access (already documented in CLAUDE.md).

#### FR-013: Deployment Pipeline

Agent-driven deployment with safety gates:

```
Agent decides to deploy
  → Pre-deploy hook: run tests + lint + typecheck
    → If pass: build production bundle
      → Create release (version bump)
        → Push to registry
          → Trigger K8s rollout
            → Post-deploy hook: health check
              → If healthy: done
              → If unhealthy: auto-rollback
```

---

## 8. Implementation Phases

### Phase 1: Federated MCP + Standalone Mode (P0)

**Dependencies**: None (extends existing infrastructure)

| Step | Description | Files |
|------|-------------|-------|
| 1.1 | Standalone MCP entry point (works without dev server) | `src/cli/mcp/stdio-entrypoint.ts` (new), `deno.json` (modify) |
| 1.2 | Upgrade to official `@modelcontextprotocol/sdk` | `src/cli/mcp/server.ts` (rewrite) |
| 1.3 | Add git/VCS MCP tools | `src/cli/mcp/git-tools.ts` (new) |
| 1.4 | Add test runner MCP tools | `src/cli/mcp/test-tools.ts` (new) |
| 1.5 | Bridge dashboard endpoints to MCP tools | `src/cli/mcp/dashboard-tools.ts` (new) |
| 1.6 | Add production observability tools (Loki/Tempo) | `src/cli/mcp/observability-tools.ts` (new) |
| 1.7 | Implement `veryfront setup-agent` command | `src/cli/commands/setup-agent.ts` (new) |
| 1.8 | Add AGENTS.md generator | `src/cli/commands/agents-md.ts` (new) |
| 1.9 | Add new MCP resources and prompts | `src/cli/mcp/server.ts` (modify) |
| 1.10 | Verify compatibility with 6 major agents | Manual testing + CI |

### Phase 2: Embedded CLI Agent (P1)

**Dependencies**: Phase 1 (uses MCP tools)

| Step | Description | Files |
|------|-------------|-------|
| 2.1 | Add Claude Agent SDK dependency | `deno.json` (modify) |
| 2.2 | Implement `veryfront agent` command | `src/cli/commands/agent.ts` (new) |
| 2.3 | Build agent system prompt | `src/cli/agent/system-prompt.ts` (new) |
| 2.4 | Implement in-process MCP tool bridge | `src/cli/agent/mcp-bridge.ts` (new) |
| 2.5 | Add persistent memory (Redis + file) | `src/cli/agent/memory.ts` (new) |
| 2.6 | Implement hook system | `src/cli/agent/hooks.ts` (new) |
| 2.7 | Add agent-as-MCP-server mode | `src/cli/agent/mcp-server.ts` (new) |
| 2.8 | Build interactive terminal UI | `src/cli/agent/terminal-ui.ts` (new) |

### Phase 3: Production Integration (P2)

**Dependencies**: Phase 1 (MCP tools), Phase 2 (agent for orchestration)

| Step | Description | Files |
|------|-------------|-------|
| 3.1 | Implement Kubernetes MCP tools | `src/cli/mcp/k8s-tools.ts` (new) |
| 3.2 | Build deployment workflow with approval gates | `src/cli/agent/deploy-pipeline.ts` (new) |
| 3.3 | Add auto-rollback on health check failure | `src/cli/agent/rollback.ts` (new) |
| 3.4 | Cross-server tool orchestration (renderer + API in workflows) | `src/cli/agent/cross-server.ts` (new) |

---

## 9. External Agent Compatibility Matrix

### 9.1 How Each Agent Connects (Federated -- Two Servers)

| Agent | Renderer (local) | API (remote) | Context File |
|-------|-------------------|--------------|--------------|
| **Claude Code** | stdio (`.mcp.json`) | Streamable HTTP (`.mcp.json`) | `CLAUDE.md` + `AGENTS.md` |
| **Codex CLI** | stdio (`config.toml`) | Streamable HTTP (`config.toml`) | `AGENTS.md` |
| **Gemini CLI** | stdio (`settings.json`) | Streamable HTTP + OAuth (`settings.json`) | `AGENTS.md` |
| **Cursor** | stdio (project config) | Streamable HTTP (project config) | `.cursor/rules` + `AGENTS.md` |
| **Windsurf** | stdio (built-in) | Streamable HTTP (built-in) | `AGENTS.md` |
| **Cline** | stdio (VS Code settings) | Streamable HTTP (VS Code settings) | `AGENTS.md` |

### 9.2 Configuration Examples (Both Servers)

**Claude Code** (`.mcp.json` -- generated by `veryfront setup-agent`):
```json
{
  "mcpServers": {
    "veryfront-dev": {
      "command": "deno",
      "args": ["task", "mcp"],
      "cwd": "/path/to/project"
    },
    "veryfront-api": {
      "type": "streamable-http",
      "url": "https://api.veryfront.com/mcp",
      "headers": {
        "Authorization": "Bearer ${VERYFRONT_API_TOKEN}"
      }
    }
  }
}
```

**Codex CLI** (`~/.codex/config.toml`):
```toml
[mcp_servers.veryfront-dev]
command = "deno"
args = ["task", "mcp"]
cwd = "/path/to/project"

[mcp_servers.veryfront-api]
type = "streamable-http"
url = "https://api.veryfront.com/mcp"
headers = { Authorization = "Bearer ${VERYFRONT_API_TOKEN}" }
```

**Gemini CLI** (`~/.gemini/settings.json`):
```json
{
  "mcpServers": {
    "veryfront-dev": {
      "command": "deno",
      "args": ["task", "mcp"],
      "cwd": "/path/to/project"
    },
    "veryfront-api": {
      "url": "https://api.veryfront.com/mcp",
      "headers": {
        "Authorization": "Bearer ${VERYFRONT_API_TOKEN}"
      }
    }
  }
}
```

### 9.3 Required: `deno task mcp` Entry Point

Add a new Deno task that starts the MCP server in stdio mode (standalone -- does NOT require dev server):

```json
{
  "tasks": {
    "mcp": "deno run -A src/cli/mcp/stdio-entrypoint.ts"
  }
}
```

This entry point:
- Starts instantly (no dev server boot)
- Provides all non-server-dependent tools immediately (git, tests, lint, project context, scaffolding, skills, conventions, file reading)
- Detects running dev server and bridges to it for live data (errors, logs, HMR, flywheel)
- Returns helpful "dev server not running" messages for server-dependent tools

---

## 10. Data Architecture

### 10.1 Federated Tool Ownership

```
┌─────────────────────────────────┐    ┌─────────────────────────────────┐
│   RENDERER MCP (local, stdio)   │    │    API MCP (remote, HTTP)       │
│                                 │    │                                 │
│   Coding:                       │    │   Planning:                     │
│   ├── vf_get_project_context    │    │   ├── list_projects             │
│   ├── vf_list_routes            │    │   ├── create_project            │
│   ├── vf_scaffold               │    │   └── update_project            │
│   ├── vf_get_conventions        │    │                                 │
│   ├── vf_git_status/diff/log    │    │   Coding (cloud):               │
│   └── vf_get_component_tree     │    │   ├── list_files, get_files     │
│                                 │    │   ├── create_file, update_file  │
│   Testing:                      │    │   ├── search_files (vector)     │
│   ├── vf_run_tests              │    │   └── move_file, delete_file    │
│   ├── vf_run_typecheck          │    │                                 │
│   ├── vf_run_lint               │    │   Branching:                    │
│   └── vf_verify                 │    │   ├── create_branch             │
│                                 │    │   ├── merge_branch              │
│   Debugging:                    │    │   └── get_branch_status         │
│   ├── vf_get_errors             │    │                                 │
│   ├── vf_get_logs               │    │   Deploying:                    │
│   ├── vf_preview_route          │    │   ├── create_release            │
│   ├── vf_get_flywheel_status    │    │   ├── deploy_release            │
│   ├── vf_get_server_stats       │    │   ├── list_deployments          │
│   ├── vf_get_metrics            │    │   ├── create_environment        │
│   └── vf_get_memory_stats       │    │   └── add_domain               │
│                                 │    │                                 │
│   Monitoring:                   │    │   Team/Admin:                   │
│   ├── vf_query_prod_logs        │    │   ├── list_members, add_member  │
│   ├── vf_query_traces           │    │   ├── create_api_key            │
│   └── vf_query_prod_metrics     │    │   └── get_subscription          │
│                                 │    │                                 │
│   Framework:                    │    │   Search:                       │
│   ├── vf_get_skills             │    │   ├── search_files (vector)     │
│   ├── vf_create_project         │    │   └── upsert_embeddings         │
│   └── vf_trigger_hmr            │    │                                 │
│                                 │    │   + 30 more tools               │
│   Data sources:                 │    │   Data sources:                 │
│   ├── Local filesystem          │    │   ├── PostgreSQL                │
│   ├── Dev server (in-process)   │    │   ├── Redis                     │
│   ├── Git (shell exec)          │    │   ├── Kubernetes                │
│   ├── Test runner (shell exec)  │    │   └── Stripe                    │
│   └── Grafana Cloud (HTTP)      │    │                                 │
└─────────────────────────────────┘    └─────────────────────────────────┘
```

### 10.2 Context Flow (Federated)

```
Agent Request (Claude Code / Codex / Gemini CLI)
  │
  ├──► Renderer MCP (stdio, local)
  │      │
  │      ├──► In-process tool → DevServer errors, logs, metrics
  │      ├──► Shell exec → git status, deno task test
  │      ├──► File read → Project context, routes, components
  │      ├──► Dashboard bridge → HTTP localhost → /_dev/api/*
  │      └──► Grafana HTTP → Loki/Tempo/Prometheus queries
  │
  └──► API MCP (Streamable HTTP, authenticated)
         │
         ├──► list_files → PostgreSQL → File versions
         ├──► create_release → Release pipeline → K8s rollout
         ├──► search_files → Vector DB → Semantic results
         ├──► deploy_release → Deployment → Environment
         └──► list_members → Team management
```

### 10.3 MCP Context Efficiency

MCP tool descriptions consume context tokens in agents. With ~75 tools across two servers, this is a concern.

**Mitigation strategies:**

1. **Tool search** (Claude Code feature): When tool descriptions exceed 10% of context, Claude Code auto-activates tool search -- loading tool descriptions on-demand rather than all at once. This already works.

2. **Concise descriptions**: Keep tool descriptions to 1-2 sentences. Current tools average ~20 words each (good). Avoid embedding usage examples in descriptions.

3. **Lazy tool registration**: Register tools in categories. The MCP server can expose a `vf_discover_tools` meta-tool that returns categories, and agents load tools on demand.

4. **Resource-based context**: Use MCP Resources (not Tools) for reference data. Resources are loaded via `@` syntax only when referenced, not auto-loaded into context.

5. **Server-level filtering**: The renderer MCP server can accept an `--categories` flag to only expose relevant tool subsets:
   ```bash
   deno task mcp                    # All tools
   deno task mcp --categories=code  # Only coding tools
   ```

6. **API vs MCP tradeoff**: For the remote API, Streamable HTTP MCP is preferred over a raw REST API because:
   - MCP provides tool discovery (agents know what's available)
   - MCP provides schema validation (agents know input/output shapes)
   - MCP is the standard all agents speak
   - Raw REST would require agents to discover and understand OpenAPI specs

   The context cost (~50 tool descriptions x ~30 tokens = ~1,500 tokens) is minimal compared to the benefits of discoverability.

---

## 11. Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| **API key management complexity** | High | Medium | Document in CLAUDE.md; use env vars; support `op` (1Password) integration |
| **MCP protocol breaking changes** | Medium | High | Pin MCP SDK version; abstract transport layer; monitor spec updates |
| **Agent hallucination on deployment** | Medium | Critical | Approval gates for all destructive operations; dry-run mode; hook system |
| **Production credential exposure** | Low | Critical | Never pass credentials via MCP tool responses; use env vars only; audit logging |
| **Context window overflow** | High | Medium | Lazy tool loading; resource pagination; summary tools before detail tools |
| **External agent compatibility drift** | Medium | Medium | CI tests with each major agent; AGENTS.md standard compliance |
| **Claude Agent SDK Deno compatibility** | Medium | High | Verify SDK works in Deno runtime; fallback to HTTP-based SDK calls if needed |
| **Rate limiting on production APIs** | Medium | Low | Cache production queries; rate limit MCP tool calls; TTL on results |

---

## 12. Security Considerations

### 12.1 Access Control

- **MCP server binds to localhost only** (default). Remote access requires explicit opt-in.
- **Production tools require credentials** via environment variables (never hardcoded, never in MCP responses).
- **Destructive operations** (deploy, rollback, delete) require explicit confirmation in embedded agent; MCP tools return dry-run results by default.

### 12.2 Credential Management

| Credential | Storage | Access Pattern |
|------------|---------|---------------|
| Anthropic API key | `ANTHROPIC_API_KEY` env var | Embedded agent only |
| Grafana Cloud | `LOKI_PASSWORD` / `TEMPO_TOKEN` | Production MCP tools |
| Kubernetes | `KUBECONFIG` file | K8s MCP tools |
| OAuth tokens | Proxy token manager | Renderer runtime |

### 12.3 Audit Trail

- All MCP tool calls are traced via OpenTelemetry
- Embedded agent sessions are recorded to `~/.veryfront/agent-sessions/`
- Destructive operations are logged with full context

---

## 13. Dev UI Integration

The existing Dev Dashboard UI (`src/server/handlers/dev/dashboard/ui/`) can serve as:

1. **Visual complement to agent tools**: Agent operations visualized in the dashboard (e.g., agent triggers a build, dashboard shows build progress).
2. **Agent conversation viewer**: New dashboard panel showing active agent sessions, tool calls, and results.
3. **Tool playground**: Dashboard already has tool execution UI -- enhance it for testing MCP tools interactively.
4. **Configuration UI**: Manage MCP server settings, agent preferences, and hook configuration through the dashboard.

This is a Phase 2+ enhancement. The dashboard REST API is the shared data layer that both the dashboard UI and MCP tools consume.

---

## 14. Future Considerations

- **Multi-agent orchestration**: Multiple specialized agents (code agent, test agent, deploy agent) coordinated via workflows
- **Agent marketplace**: Community-contributed agent configurations and tool packs
- **Cloud-hosted agent**: Veryfront Cloud service running agents with persistent sessions
- **Real-time collaboration**: Agent and developer working on the same file simultaneously
- **Agent Skills packaging**: Package Veryfront-specific agent skills in the Vercel Agent Skills format for cross-platform distribution

---

## 15. Self-Score (100-point Framework)

### AI-Specific Optimization (25 pts): 22/25

- [x] MCP protocol compliance (5/5)
- [x] Multi-agent compatibility (5/5)
- [x] Context efficiency addressed (4/5) -- could detail token budgets
- [x] Tool schema design (4/5) -- Zod schemas well-defined
- [x] Agent-native UX patterns (4/5)

### Traditional PRD Core (25 pts): 23/25

- [x] Clear problem statement with gaps analysis (5/5)
- [x] Measurable success metrics (5/5)
- [x] Well-defined personas (4/5)
- [x] Explicit non-goals (5/5)
- [x] Risk analysis with mitigations (4/5) -- could add more quantitative risk scores

### Implementation Clarity (30 pts): 27/30

- [x] Phased delivery plan (6/6)
- [x] Dependencies mapped (5/5)
- [x] File-level implementation steps (5/5)
- [x] Architecture options evaluated with recommendation (6/6)
- [x] External agent compatibility matrix (5/5) -- could include version requirements
- [ ] Acceptance criteria per FR (-3)

### Completeness (20 pts): 18/20

- [x] Security considerations (4/4)
- [x] Data architecture (4/4)
- [x] Existing infrastructure leveraged (5/5)
- [x] Future considerations (3/3)
- [x] Dev UI integration plan (2/2) -- brief but sufficient
- [ ] API contract examples (-2)

**Total: 90/100**

---

## Appendix A: Existing MCP Tools Inventory

| Tool | SDLC Phase | Status |
|------|-----------|--------|
| `vf_get_errors` | Debug | Exists |
| `vf_get_logs` | Debug | Exists |
| `vf_clear_cache` | Debug | Exists |
| `vf_get_status` | Debug | Exists |
| `vf_clear_errors` | Debug | Exists |
| `vf_list_routes` | Code | Exists |
| `vf_get_project_context` | Code | Exists |
| `vf_scaffold` | Code | Exists |
| `vf_get_conventions` | Code | Exists |
| `vf_hot_reload` | Debug | Exists |
| `vf_trigger_hmr` | Debug | Exists |
| `vf_get_debug_context` | Debug | Exists |
| `vf_preview_route` | Debug/Test | Exists |
| `vf_get_component_tree` | Code | Exists |
| `vf_get_skills` | Code | Exists |
| `vf_get_skill_reference` | Code | Exists |
| `vf_list_local_projects` | Code | Exists |
| `vf_list_examples` | Code | Exists |
| `vf_list_templates` | Code | Exists |
| `vf_list_integrations` | Code | Exists |
| `vf_list_usecases` | Code | Exists |
| `vf_create_project` | Code | Exists |
| `vf_wait_for_ready` | Debug | Exists |
| `vf_get_flywheel_status` | Debug | Exists |
| Remote file tools (3) | Code | Exists |
| Issue tools (varies) | Plan | Exists |

**Existing renderer coverage**: 25 tools across 2 SDLC phases (Code, Debug)
**Target renderer coverage**: 40+ tools across 4 SDLC phases (Code, Test, Debug, Monitor)

## Appendix B: API MCP Tools Inventory (Already Built)

The `veryfront-api` MCP server at `/mcp` (Streamable HTTP) provides 50+ tools across 19 groups:

| Tool Group | Tools | SDLC Phase |
|-----------|-------|------------|
| Projects | list, get, create, update, delete | Plan |
| Files | list, get, create, update, move, delete, publish | Code |
| Branches | list, create, merge, delete, status | Code |
| Search | search_files, chunks, embeddings | Code |
| Releases | list, create, deploy, get | Deploy |
| Deployments | list, get, latest | Deploy |
| Environments | list, create, update, delete, variables | Deploy |
| Domains | list, add, delete | Deploy |
| Members | list, add, update, remove | Plan |
| API Keys | list, create, get, update, delete | Admin |
| Integrations | list | Admin |
| Templates | list | Code |
| Uploads | create_url, list, delete | Code |
| Resources | limits | Admin |
| Favorites | list, add, remove | Admin |
| Cache | status, clear | Debug |
| Subscriptions | get, usage | Admin |
| User | me | Admin |
| Images | upload, list | Code |

**Transport**: Streamable HTTP (`@modelcontextprotocol/sdk`)
**Auth**: JWT + API keys with per-tool scope checking (read, write, delete)
**Status**: Production, fully operational

## Appendix C: MCP Protocol Version

This PRD targets **MCP Protocol Version 2024-11-05** (current stable). The implementation should be forward-compatible with upcoming v2 SDK releases (anticipated Q1 2026).

**Renderer MCP transport priority:**
1. **stdio** (primary) -- for all local agent connections (standalone mode)
2. **Streamable HTTP** (secondary) -- for dev dashboard and remote connections

**API MCP transport:**
1. **Streamable HTTP** (only) -- stateless, authenticated, production-grade
