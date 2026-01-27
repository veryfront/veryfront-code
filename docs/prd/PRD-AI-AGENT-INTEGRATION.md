# PRD: Standalone MCP Server & Claude Code Plugin

**Status**: Draft
**Date**: 2026-01-27
**Version**: 3.0
**Priority**: P0

---

## 1. Summary

Make the Veryfront MCP server work without the dev server running, and package it as a Claude Code plugin.

1. **`veryfront mcp`** -- Standalone CLI subcommand. Starts the MCP server over stdio. Works without `veryfront`. Decoupled process.

2. **Claude Code plugin** -- Skills (conventions, flywheel), MCP config, and project detection. Distributed via Git marketplace.

```
┌────────────────────────────────────────┐
│  Claude Code                           │
│                                        │
│  veryfront plugin                      │
│  ├── skills (conventions, flywheel)    │
│  └── MCP: veryfront mcp (stdio)       │
│       ├── project context, routes      │
│       ├── scaffold, conventions        │
│       └── errors, logs (when dev runs) │
└────────────────────────────────────────┘
```

> **Out of scope**: The Veryfront API has its own MCP server (`api.veryfront.com/mcp`) with 50+ tools for platform operations (files, branches, releases, deployments). That's a separate product surface, already shipped, and not part of this PRD.

---

## 2. Problem

The Veryfront MCP server only starts when the dev server is running (`veryfront`). When it's not, agents show `x failed` and lose all Veryfront tools.

---

## 3. What Exists

| Component | Tools | Status |
|-----------|-------|--------|
| MCP Server (`src/cli/mcp/server.ts`) | 25+ (project context, routes, scaffold, errors, logs, HMR, flywheel) | Coupled to dev server -- runs in-process, reads in-memory singletons |
| Skills (`src/cli/mcp/skills/`) | Veryfront conventions, flywheel workflow | Loaded via MCP prompts |
| Dev Dashboard API (`src/server/handlers/dev/dashboard/api.ts`) | 15+ REST endpoints (`/_dev/api/*`: stats, metrics, memory, config, build) | HTTP API inside the user's `veryfront` process |

**Current coupling**: The MCP server, error collector (`ErrorCollector`), and log buffer (`LogBuffer`) are in-memory singletons inside the same process as the dev server. MCP tools read them directly via `getErrorCollector()` and `getLogBuffer()`. There is no HTTP or IPC layer -- they share memory. This is why MCP only works when `veryfront` is running.

---

## 4. What to Build

### 4.1 `veryfront mcp` subcommand

Starts the MCP server over stdio. Standalone process. Does NOT require `veryfront`.

```bash
# Agent spawns this (via plugin or manual config):
veryfront mcp

# User separately runs (optional):
veryfront
```

Two processes. No conflicts. No shared state.

**Always-available tools** (filesystem-based, all exist today):

| Tool | Description | Source |
|------|-------------|--------|
| `vf_get_project_context` | Project structure, router type, features, integrations | `advanced-tools.ts` |
| `vf_list_routes` | Discover all routes (pages, API, layouts) | `advanced-tools.ts` |
| `vf_scaffold` | Generate pages, components, API routes, tools, agents | `advanced-tools.ts` |
| `vf_get_conventions` | Coding conventions and patterns | `advanced-tools.ts` |
| `vf_get_component_tree` | Component hierarchy | `advanced-tools.ts` |
| `vf_get_skills` | Available skills and references | `advanced-tools.ts` |

No new tools needed. Git (`git status`, `git diff`), tests (`deno task test`), lint (`deno task lint`), and typecheck (`deno task typecheck`) are already available natively in every AI agent via shell access. Wrapping them in MCP tools adds no capability. The `veryfront` skill/prompt already teaches agents the correct commands.

**Dev-server-dependent tools** (pull from Dev Dashboard API when running, graceful fallback otherwise):

These tools exist because the user's `veryfront` process owns runtime state (errors, logs, HMR, metrics) in memory. The standalone MCP process cannot access that memory directly. Instead, it **pulls** data from the Dev Dashboard API (`/_dev/api/*`) running inside the user's process over HTTP.

| Tool | Dev Dashboard Endpoint | Fallback |
|------|----------------------|----------|
| `vf_get_errors` | `/_dev/api/errors` | "Dev server not running. Start with: veryfront" |
| `vf_get_logs` | `/_dev/api/logs` | Same |
| `vf_get_flywheel_status` | `/_dev/api/stats` | Same |
| `vf_preview_route` | `/_dev/api/preview` | Same |
| `vf_trigger_hmr` | `/_dev/api/hmr` | Same |
| `vf_get_server_stats` | `/_dev/api/stats` | Same |
| `vf_get_metrics` | `/_dev/api/metrics` | Same |

**Dev server detection**: The MCP process probes `localhost:{port}/_dev/api/stats` (default port: 8080, overridable via `veryfront mcp --port`). If it responds, pull from it. If not, return the fallback. 500ms timeout. Fail open.

**New endpoints required**: The Dev Dashboard API currently exposes stats, metrics, memory, config, and build data. It does **not** expose the live `ErrorCollector` or `LogBuffer` contents. Two new endpoints are needed inside the user's `veryfront` process:

| New Endpoint | Source | Purpose |
|-------------|--------|---------|
| `/_dev/api/live-errors` | `getErrorCollector().getAll()` | Live compile/runtime/bundle errors |
| `/_dev/api/live-logs` | `getLogBuffer().query()` | Recent server log entries |

**Resources and prompts**: Same as today (`veryfront://errors`, `veryfront://logs`, `issues://`, skills, flywheel).

### 4.2 Claude Code Plugin

```
veryfront-plugin/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   ├── veryfront/SKILL.md      # Conventions, patterns, scaffolding
│   └── flywheel/SKILL.md       # Dev loop workflow
├── .mcp.json                    # MCP server config
└── hooks/
    └── hooks.json               # SessionStart detection
```

**plugin.json**:
```json
{
  "name": "veryfront",
  "version": "1.0.0",
  "description": "Veryfront framework -- conventions, dev tools, project intelligence",
  "skills": "./skills/",
  "hooks": "./hooks/hooks.json",
  "mcpServers": "./.mcp.json"
}
```

**.mcp.json**:
```json
{
  "mcpServers": {
    "veryfront": {
      "command": "veryfront",
      "args": ["mcp"]
    }
  }
}
```

**hooks.json**:
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

Or in a project's `.claude/settings.json`:
```json
{
  "plugins": ["veryfront@veryfront/claude-plugins"]
}
```

### 4.3 Other Agents

Codex CLI, Gemini CLI, Cursor configure `veryfront mcp` as a stdio MCP server. No plugin needed.

```toml
# Codex CLI (~/.codex/config.toml)
[mcp_servers.veryfront]
command = "veryfront"
args = ["mcp"]
```

```json
// Gemini CLI (~/.gemini/settings.json)
{ "mcpServers": { "veryfront": { "command": "veryfront", "args": ["mcp"] } } }
```

---

## 5. What NOT to Build

| Idea | Why not |
|------|---------|
| MCP wrappers for git, tests, lint, typecheck | Agents already have shell access. `git status`, `deno task test`, etc. work natively. The `veryfront` skill teaches agents the right commands. |
| Embedded CLI agent | Claude Code, Codex, Gemini are better agents. Feed them, don't compete. |
| `veryfront setup-agent` | Config is 3 lines of JSON. Docs are enough. |
| AGENTS.md generator | CLAUDE.md exists. Symlink or copy if needed. |
| Agent hooks/memory system | Agents manage their own. Don't reinvent. |
| Dashboard-to-MCP bridge for all 15 endpoints | A few key ones (errors, logs, stats) via dev server probe is enough. |

---

## 6. Architecture

```
Process 1: veryfront              Process 2: veryfront mcp
(user starts manually)            (agent spawns via plugin)

┌─────────────────────┐           ┌─────────────────────┐
│ Dev Server          │           │ MCP Server (stdio)  │
│ ├── SSR/RSC engine  │           │                     │
│ ├── HMR server      │  HTTP     │ Always-available:   │
│ ├── File watcher    │  pull     │ ├── Project context │
│ ├── Error collector │◄─────────│ ├── Routes          │
│ ├── Log buffer      │ (/_dev/) │ ├── Scaffold        │
│ └── Dashboard API ──┤           │ ├── Conventions     │
│    /_dev/api/stats   │           │ └── Skills/prompts  │
│    /_dev/api/live-   │           │                     │
│      errors          │           │ Dev-dependent:      │
│    /_dev/api/live-   │           │ └── Pulls from      │
│      logs            │           │     Dashboard API   │
└─────────────────────┘           └─────────────────────┘
                                         ▲
                                         │ stdio
                                  ┌──────┴──────┐
                                  │  AI Agent   │
                                  └─────────────┘
```

**Data flow**: The user's `veryfront` process owns all runtime state (errors, logs, HMR, metrics) in memory. The Dev Dashboard API (`/_dev/api/*`) exposes this state over HTTP. The standalone `veryfront mcp` process **pulls** from these endpoints when an agent calls a dev-dependent tool. Always-available tools (project context, routes, scaffold, conventions) read the filesystem directly -- no dev server needed.

**No conflicts**: MCP uses stdio (no port). Dev server uses its port. No shared state. Multiple agents can each spawn their own `veryfront mcp` process.

---

## 7. Implementation

### Step 1: Standalone MCP

| Task | Files |
|------|-------|
| `mcp` subcommand entry point | `src/cli/commands/mcp.ts` (new) |
| Decouple existing tools from in-memory singletons | `src/cli/mcp/tools.ts` (refactor) |
| Dev server probe + HTTP pull client | `src/cli/mcp/dev-server-probe.ts` (new) |
| Add `/_dev/api/live-errors` endpoint | `src/server/handlers/dev/dashboard/api.ts` (modify) |
| Add `/_dev/api/live-logs` endpoint | `src/server/handlers/dev/dashboard/api.ts` (modify) |
| Register in CLI router | `src/cli/index/command-router.ts` (modify) |
| Add `deno task mcp` | `deno.json` (modify) |

### Step 2: Plugin

| Task | Repo |
|------|------|
| Create plugin structure | `veryfront/claude-plugins` (new repo) |
| Copy skills from `src/cli/mcp/skills/` | Plugin repo |
| Write `.mcp.json` | Plugin repo |
| Add SessionStart hook | Plugin repo |
| Publish marketplace | Plugin repo |

### Step 3: Docs

| Task | Location |
|------|----------|
| `veryfront mcp` subcommand | CLI help + README |
| Agent config examples (Codex, Gemini, Cursor) | README |
| Plugin install instructions | Plugin repo README |

---

## 8. Success Criteria

| Criteria | Test |
|----------|------|
| `veryfront mcp` starts without dev server | Process stays alive, tools respond |
| Plugin installs in Claude Code | `/plugin install veryfront` works, tools appear |
| Dev-dependent tools degrade gracefully | Returns helpful message, doesn't crash |
| Dev-dependent tools work when dev server runs | Probes and proxies correctly |
| No conflicts with `veryfront` | Both run simultaneously |

---

## 9. Risks

| Risk | Mitigation |
|------|------------|
| `veryfront` not on PATH | Fallback to `npx veryfront mcp` in plugin config |
| Dev server detection flaky | 500ms timeout, fail open |
| Plugin system changes | Format is simple (JSON + markdown), easy to adapt |

---

## 10. Future (Only If Needed)

- Production monitoring tools (Loki/Tempo queries)
- More dashboard bridge tools
- Plugins for other agents (if they ship plugin systems)
