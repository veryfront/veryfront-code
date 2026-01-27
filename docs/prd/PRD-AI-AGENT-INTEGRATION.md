# PRD: Standalone MCP Server & Claude Code Plugin

**Status**: Draft
**Date**: 2026-01-27
**Version**: 3.0
**Priority**: P0

---

## 1. Summary

Make the Veryfront MCP server work without the dev server running, and package it as a Claude Code plugin.

1. **`veryfront mcp`** -- Standalone CLI subcommand. Starts the MCP server over stdio. Works without `veryfront dev`. Decoupled process.

2. **Claude Code plugin** -- Skills (conventions, flywheel), MCP config, and project detection. Distributed via Git marketplace.

```
┌────────────────────────────────────────┐
│  Claude Code                           │
│                                        │
│  veryfront plugin                      │
│  ├── skills (conventions, flywheel)    │
│  └── MCP: veryfront mcp (stdio)       │
│       ├── project context, routes      │
│       ├── git, tests, lint             │
│       ├── scaffold, conventions        │
│       └── errors, logs (when dev runs) │
└────────────────────────────────────────┘
```

> **Out of scope**: The Veryfront API has its own MCP server (`api.veryfront.com/mcp`) with 50+ tools for platform operations (files, branches, releases, deployments). That's a separate product surface, already shipped, and not part of this PRD.

---

## 2. Problem

The Veryfront MCP server only starts when the dev server is running (`veryfront dev`). When it's not, agents show `x failed` and lose all Veryfront tools.

---

## 3. What Exists

| Component | Tools | Status |
|-----------|-------|--------|
| MCP Server (`src/cli/mcp/server.ts`) | 25+ (project context, routes, scaffold, errors, logs, HMR, flywheel) | Coupled to dev server |
| Skills (`src/cli/mcp/skills/`) | Veryfront conventions, flywheel workflow | Loaded via MCP prompts |
| Dev Dashboard (`src/server/handlers/dev/dashboard/api.ts`) | 15+ REST endpoints (stats, metrics, memory, config, build) | Available during `veryfront dev` |

---

## 4. What to Build

### 4.1 `veryfront mcp` subcommand

Starts the MCP server over stdio. Standalone process. Does NOT require `veryfront dev`.

```bash
# Agent spawns this (via plugin or manual config):
veryfront mcp

# User separately runs (optional):
veryfront dev
```

Two processes. No conflicts. No shared state.

**Always-available tools** (filesystem + shell):

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

**Dev-server-dependent tools** (proxy to dev server when running, graceful fallback otherwise):

| Tool | Fallback |
|------|----------|
| `vf_get_errors` | "Dev server not running. Start with: veryfront dev" |
| `vf_get_logs` | Same |
| `vf_get_flywheel_status` | Same |
| `vf_preview_route` | Same |
| `vf_trigger_hmr` | Same |
| `vf_get_server_stats` | Same |
| `vf_get_metrics` | Same |

**Dev server detection**: Probe `localhost:{port}/_dev/api/stats`. If it responds, proxy to it. If not, return the fallback. 500ms timeout. Fail open.

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
| Embedded CLI agent | Claude Code, Codex, Gemini are better agents. Feed them, don't compete. |
| `veryfront setup-agent` | Config is 3 lines of JSON. Docs are enough. |
| AGENTS.md generator | CLAUDE.md exists. Symlink or copy if needed. |
| Agent hooks/memory system | Agents manage their own. Don't reinvent. |
| Dashboard-to-MCP bridge for all 15 endpoints | A few key ones (stats, metrics) via dev server probe is enough. |

---

## 6. Architecture

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
                                  ┌──────┴──────┐
                                  │  AI Agent   │
                                  └─────────────┘
```

**No conflicts**: MCP uses stdio (no port). Dev server uses its port. No shared state. Multiple agents can each spawn their own `veryfront mcp` process.

---

## 7. Implementation

### Step 1: Standalone MCP

| Task | Files |
|------|-------|
| `mcp` subcommand entry point | `src/cli/commands/mcp.ts` (new) |
| Extract tools into standalone functions | `src/cli/mcp/tools.ts` (refactor) |
| Dev server probe | `src/cli/mcp/dev-server-probe.ts` (new) |
| Git tools | `src/cli/mcp/git-tools.ts` (new) |
| Test/lint/typecheck tools | `src/cli/mcp/test-tools.ts` (new) |
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
| No conflicts with `veryfront dev` | Both run simultaneously |

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
