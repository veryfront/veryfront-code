# PRD: AI Agent Integration for Veryfront CLI

**Status**: Draft
**Date**: 2026-01-27
**Version**: 2.0
**Priority**: P0

---

## 1. Summary

Give AI coding agents full access to Veryfront projects by shipping two things:

1. **`veryfront mcp`** -- A standalone MCP subcommand in the CLI binary that exposes dev-time tools (project context, git, tests, errors, logs) over stdio. Works without the dev server running. Decoupled process.

2. **Claude Code plugin** -- A lightweight plugin that bundles skills (conventions, flywheel), MCP config (local CLI + remote API), and project detection. Distributed via Git marketplace.

The Veryfront API already has a production MCP server with 50+ tools for platform operations (files, branches, releases, deployments, environments, search, members). We don't rebuild any of that.

```
┌─────────────────────────────────────────────────────┐
│  Claude Code (or Codex / Gemini CLI / Cursor)       │
│                                                     │
│  MCP Server 1: veryfront mcp (stdio, local)         │
│  └── git, tests, lint, routes, scaffold, errors,    │
│      logs, project context, conventions, skills     │
│                                                     │
│  MCP Server 2: api.veryfront.com/mcp (HTTP, remote) │
│  └── projects, files, branches, releases, deploys,  │
│      environments, domains, search, members         │
└─────────────────────────────────────────────────────┘
```

---

## 2. Problem

Today the Veryfront MCP server only starts when the dev server is running (`deno task dev`). When it's not running, agents like Claude Code show `x failed` and lose access to all Veryfront tools.

This is the entire problem. Everything else already works.

---

## 3. What Exists Today

| Component | Location | Tools | Status |
|-----------|----------|-------|--------|
| Renderer MCP | `src/cli/mcp/server.ts` | 25+ (project context, routes, scaffold, errors, logs, HMR, flywheel) | Works only during `deno task dev` |
| API MCP | `veryfront-api/src/api/http/mcp/handler.ts` | 50+ (projects, files, branches, releases, deploys, environments, search, members, API keys, domains) | Production, Streamable HTTP, auth + scopes |
| Skills | `src/cli/mcp/skills/` | Veryfront conventions, flywheel workflow | Loaded via MCP prompts |
| Dev Dashboard | `src/server/handlers/dev/dashboard/api.ts` | 15+ REST endpoints (stats, metrics, memory, config, build) | Works during `deno task dev` |

---

## 4. What to Build

### 4.1 `veryfront mcp` subcommand

A new CLI subcommand that starts the MCP server over stdio. Standalone -- does NOT require `veryfront dev` to be running.

```bash
# Claude Code / Codex / Gemini CLI spawns this:
veryfront mcp

# User separately runs (optional):
veryfront dev
```

Two separate processes. No conflicts. No shared state.

**Always-available tools** (filesystem + shell, no dev server needed):

| Tool | Description |
|------|-------------|
| `vf_get_project_context` | Project structure, router type, features, integrations |
| `vf_list_routes` | Discover all routes (pages, API, layouts) |
| `vf_scaffold` | Generate pages, components, API routes, tools, agents |
| `vf_get_conventions` | Coding conventions and patterns |
| `vf_get_component_tree` | Component hierarchy |
| `vf_get_skills` | Available skills and references |
| `vf_git_status` | Staged, modified, untracked files |
| `vf_git_diff` | View changes |
| `vf_git_log` | Recent commits |
| `vf_run_tests` | Run test suite, return results |
| `vf_run_typecheck` | TypeScript type checking |
| `vf_run_lint` | Linter with optional fix |
| `vf_verify` | Run lint + typecheck + tests |

**Dev-server-dependent tools** (connect to running dev server via HTTP if available, otherwise return helpful message):

| Tool | Description | Fallback when dev server not running |
|------|-------------|--------------------------------------|
| `vf_get_errors` | Compilation/runtime errors | "No dev server running. Start with: veryfront dev" |
| `vf_get_logs` | Dev server logs | Same |
| `vf_get_flywheel_status` | Aggregated dev status | Same |
| `vf_preview_route` | Test route rendering | Same |
| `vf_trigger_hmr` | Force browser refresh | Same |
| `vf_get_server_stats` | Request stats, cache stats | Same |
| `vf_get_metrics` | Performance metrics | Same |

**Detection**: The MCP process checks if the dev server is running by probing `localhost:{port}/_dev/api/stats`. If it responds, dev-server-dependent tools proxy to it. If not, they return the fallback message.

**Resources and prompts**: Same as today (veryfront://errors, veryfront://logs, issues://, skills, flywheel prompt).

**Implementation**: One new file (`src/cli/commands/mcp.ts`) + extract tool definitions from the current dev-server-coupled code into standalone functions.

### 4.2 Claude Code Plugin

A lightweight plugin distributed via Git marketplace.

```
veryfront-claude-plugin/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   ├── veryfront/
│   │   └── SKILL.md        # Conventions, patterns, scaffolding
│   └── flywheel/
│       └── SKILL.md        # Dev loop workflow
├── .mcp.json                # Both MCP servers
└── hooks/
    └── hooks.json           # SessionStart hook
```

**plugin.json**:
```json
{
  "name": "veryfront",
  "version": "1.0.0",
  "description": "Veryfront framework integration -- conventions, dev tools, platform access",
  "skills": "./skills/",
  "hooks": "./hooks/hooks.json",
  "mcpServers": "./.mcp.json"
}
```

**.mcp.json**:
```json
{
  "mcpServers": {
    "veryfront-dev": {
      "command": "veryfront",
      "args": ["mcp"]
    },
    "veryfront-api": {
      "type": "http",
      "url": "https://api.veryfront.com/mcp",
      "headers": {
        "Authorization": "Bearer ${VERYFRONT_API_TOKEN}"
      }
    }
  }
}
```

**hooks.json** (optional -- detect Veryfront projects):
```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "test -f veryfront.config.ts && echo 'Veryfront project detected'"
      }]
    }]
  }
}
```

**Installation**:
```
/plugin install veryfront@veryfront/claude-plugins
```

Or committed to a Veryfront project's `.claude/settings.json`:
```json
{
  "plugins": ["veryfront@veryfront/claude-plugins"]
}
```

### 4.3 Non-Claude Agent Configuration

For Codex CLI, Gemini CLI, Cursor -- they configure the same two MCP servers manually. No plugin needed.

**Codex CLI** (`~/.codex/config.toml`):
```toml
[mcp_servers.veryfront-dev]
command = "veryfront"
args = ["mcp"]

[mcp_servers.veryfront-api]
type = "streamable-http"
url = "https://api.veryfront.com/mcp"
headers = { Authorization = "Bearer ${VERYFRONT_API_TOKEN}" }
```

**Gemini CLI** (`~/.gemini/settings.json`):
```json
{
  "mcpServers": {
    "veryfront-dev": { "command": "veryfront", "args": ["mcp"] },
    "veryfront-api": { "url": "https://api.veryfront.com/mcp" }
  }
}
```

---

## 5. What NOT to Build

| Rejected idea | Why |
|---------------|-----|
| Embedded CLI agent (`veryfront agent`) | Claude Code, Codex, Gemini CLI are better agents. Don't compete -- feed them. |
| Local MCP bridge to API | Duplicates 50 already-built API tools. Adds latency. |
| `veryfront setup-agent` command | 5 lines of JSON in docs is enough. |
| AGENTS.md generator | CLAUDE.md already exists. A docs mention is sufficient. |
| Agent hooks system | Claude Code has hooks. Codex has safety levels. Don't reinvent. |
| Agent-as-MCP-server mode | Solving a problem nobody has. |
| Dashboard-to-MCP bridge for all endpoints | Agents don't need 15 dashboard endpoints. A few key ones (stats, metrics) are enough. |
| Agent memory / persistence | Claude Code and other agents manage their own memory. |

---

## 6. Architecture

### 6.1 Process Model

```
Process 1: veryfront dev          Process 2: veryfront mcp
(user starts manually)            (agent spawns via plugin)

┌─────────────────────┐           ┌─────────────────────┐
│ Dev Server          │           │ MCP Server (stdio)  │
│ ├── SSR/RSC engine  │  HTTP     │ ├── Project context │
│ ├── HMR server      │◄─────────│ ├── Git tools       │
│ ├── File watcher    │  probe    │ ├── Test runner     │
│ ├── Error collector │           │ ├── Scaffold        │
│ ├── Log buffer      │           │ ├── Skills/prompts  │
│ └── Dashboard API   │           │ └── Dev server proxy│
└─────────────────────┘           └─────────────────────┘
                                         ▲
                                         │ stdio
                                         │
                                  ┌──────┴──────┐
                                  │ Claude Code │
                                  │ (or Codex,  │
                                  │  Gemini,    │
                                  │  Cursor)    │
                                  └──────┬──────┘
                                         │ HTTP
                                         ▼
                                  ┌─────────────┐
                                  │ Veryfront   │
                                  │ API /mcp    │
                                  │ (50+ tools) │
                                  └─────────────┘
```

### 6.2 No Conflicts Between Processes

| Concern | Answer |
|---------|--------|
| Port conflict? | No. MCP process uses stdio (no port). Dev server uses its port. |
| Shared state? | No. MCP reads filesystem directly, proxies to dev server via HTTP when available. |
| File locking? | No. Git, test runner, lint are all safe to run concurrently. |
| Multiple agents? | Fine. Each agent spawns its own `veryfront mcp` process. Stateless. |

### 6.3 Tool Ownership (No Duplication)

| Domain | Owner | Rationale |
|--------|-------|-----------|
| Project context, routes, scaffold, conventions | Renderer MCP | Local filesystem knowledge |
| Git operations | Renderer MCP | Local git repo |
| Test, lint, typecheck | Renderer MCP | Local toolchain |
| Errors, logs, HMR, metrics | Renderer MCP (proxied to dev server) | Live dev server data |
| Production logs, traces | Renderer MCP (HTTP to Grafana) | Observability credentials are local env vars |
| Files, branches, releases | API MCP | Cloud-managed project data |
| Deployments, environments, domains | API MCP | Platform operations |
| Search (vector), embeddings | API MCP | Database-backed |
| Members, API keys, subscriptions | API MCP | Account management |

---

## 7. Implementation

### Step 1: `veryfront mcp` subcommand

Extract MCP tools from the dev server and make them work standalone.

| Task | Files |
|------|-------|
| New `mcp` subcommand entry point | `src/cli/commands/mcp.ts` (new) |
| Extract tools into standalone functions | `src/cli/mcp/tools.ts` (refactor) |
| Dev server probe (optional HTTP bridge) | `src/cli/mcp/dev-server-probe.ts` (new) |
| Add git tools | `src/cli/mcp/git-tools.ts` (new) |
| Add test/lint/typecheck tools | `src/cli/mcp/test-tools.ts` (new) |
| Register `mcp` in CLI command router | `src/cli/index/command-router.ts` (modify) |
| Add `deno task mcp` | `deno.json` (modify) |

### Step 2: Claude Code plugin

| Task | Repo |
|------|------|
| Create plugin directory structure | `veryfront/claude-plugins` (new repo) |
| Move skills from `src/cli/mcp/skills/` to plugin | Plugin repo |
| Write `.mcp.json` with both servers | Plugin repo |
| Add SessionStart hook | Plugin repo |
| Publish marketplace | Plugin repo |

### Step 3: Documentation

| Task | Location |
|------|----------|
| Add MCP config examples for all agents | README / docs |
| Document `veryfront mcp` subcommand | CLI help + docs |
| Plugin installation instructions | Plugin repo README |

---

## 8. Success Criteria

| Criteria | Measurement |
|----------|-------------|
| `veryfront mcp` starts without dev server | Process stays alive, tools respond |
| Claude Code plugin installs and connects | `/plugin install veryfront` works, tools appear |
| Both MCP servers accessible simultaneously | Agent can call renderer tools AND API tools in same session |
| Dev-server-dependent tools degrade gracefully | Clear message when dev server not running |
| Dev-server-dependent tools work when dev server is running | MCP process detects and proxies to dev server |
| No conflicts with concurrent `veryfront dev` | Both processes run independently |

---

## 9. Risks

| Risk | Mitigation |
|------|------------|
| `veryfront` binary not on PATH | Plugin `.mcp.json` can fallback to `npx veryfront mcp` |
| API MCP requires auth token | Plugin docs explain how to set `VERYFRONT_API_TOKEN` env var |
| Dev server detection flaky | Simple HTTP probe with 500ms timeout; fail open (tools still work without dev server) |
| Claude Code plugin system changes | Plugin format is simple (JSON + markdown); easy to adapt |

---

## 10. Future (Only If Needed)

These are explicitly deferred. Build them only if real users hit real problems:

- Production monitoring tools (Loki/Tempo queries via MCP)
- More dashboard bridge tools beyond stats/metrics
- Plugins for other agents (if they develop plugin systems)
- `veryfront setup-agent` command (if manual config proves too painful)
- AGENTS.md generation (if cross-agent standard gains traction)
