# PRD: Standalone MCP Server & Claude Code Plugin

**Status**: Draft
**Date**: 2026-01-27
**Version**: 5.0
**Priority**: P0

---

## 1. Summary

Give AI agents access to the Veryfront dev server's runtime state (errors, logs, HMR) from a separate process. Package as a Claude Code plugin.

**The problem**: The dev server holds compile errors, runtime errors, and server logs in memory. An AI agent running in a separate process (Claude Code, Codex CLI, etc.) cannot access this data. It's trapped in the `veryfront` process.

**The solution**: `veryfront mcp` -- a standalone MCP server that pulls runtime data from the dev server over HTTP and exposes it to agents via stdio.

```
┌─────────────────────┐           ┌─────────────────────┐
│ veryfront            │  HTTP     │ veryfront mcp       │
│ (user's terminal)   │  pull     │ (agent's process)   │
│                     │◄─────────│                     │
│ ErrorCollector      │           │ vf_get_errors       │
│ LogBuffer           │           │ vf_get_logs         │
│ Dashboard API       │           │ vf_get_status       │
│  /_dev/api/*        │           │ vf_trigger_hmr      │
└─────────────────────┘           └─────────────────────┘
                                         ▲ stdio
                                    ┌────┴────┐
                                    │ AI Agent│
                                    └─────────┘
```

> **Out of scope**: The Veryfront API MCP server (`api.veryfront.com/mcp`, 50+ tools) is a separate product, already shipped.

---

## 2. What Exists

| Component | Status |
|-----------|--------|
| MCP Server (`src/cli/mcp/server.ts`) | In-process. Reads `ErrorCollector` and `LogBuffer` singletons from shared memory. Dies when `veryfront` stops. |
| Dev Dashboard API (`src/server/handlers/dev/dashboard/api.ts`) | HTTP endpoints inside `veryfront`: `/_dev/api/stats`, `/_dev/api/metrics`, `/_dev/api/memory`, `/_dev/api/config`, `/_dev/api/build`. |
| Skills (`src/cli/mcp/skills/`) | Markdown files teaching agents Veryfront conventions and workflows. |

**What's missing**: The Dashboard API does not expose the live `ErrorCollector` or `LogBuffer` over HTTP. No endpoint serves compile errors, runtime errors, or server logs.

---

## 3. What to Build

### 3.1 New Dashboard Endpoints

Add to the `veryfront` process so the standalone MCP can pull runtime data:

| Endpoint | Source | Returns |
|----------|--------|---------|
| `/_dev/api/live-errors` | `getErrorCollector().getAll()` | Live compile, runtime, bundle, HMR errors |
| `/_dev/api/live-logs` | `getLogBuffer().query()` | Recent server log entries with level/source filtering |
| `/_dev/api/hmr-trigger` | `ReloadNotifier` | Triggers HMR reload, returns success |

### 3.2 `veryfront mcp` subcommand

Standalone MCP server over stdio. Agents spawn it. It pulls from the dev server's Dashboard API.

```bash
# Agent spawns this:
veryfront mcp

# User runs in another terminal:
veryfront
```

**Tools**:

| Tool | Pulls from | Without dev server |
|------|-----------|-------------------|
| `vf_get_errors` | `/_dev/api/live-errors` | "Dev server not running. Start with: veryfront" |
| `vf_get_logs` | `/_dev/api/live-logs` | Same |
| `vf_get_status` | `/_dev/api/stats` | Same |
| `vf_trigger_hmr` | `/_dev/api/hmr-trigger` | Same |

**Dev server detection**: Probe `localhost:8080/_dev/api/stats` (default port, overridable via `--port`). 500ms timeout. Fail open.

**Skills and prompts**: The `veryfront` and `flywheel` skills are served as MCP prompts. These teach the agent conventions, commands (`deno task test`, `veryfront scaffold`, etc.), and the dev workflow.

### 3.3 Claude Code Plugin

```
veryfront-plugin/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   ├── veryfront/SKILL.md
│   └── flywheel/SKILL.md
├── .mcp.json
└── hooks/
    └── hooks.json
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

**Installation**:
```
/plugin install veryfront@veryfront/claude-plugins
```

### 3.4 Other Agents

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

## 4. What NOT to Build

| Idea | Why not |
|------|---------|
| MCP tools for scaffold, project context, routes, conventions, component tree | The agent has shell access (`veryfront scaffold`, file reads). These don't need an MCP bridge -- they don't access runtime state. |
| MCP wrappers for git, tests, lint, typecheck | Same reason. `git status`, `deno task test` work natively via shell. |
| Dashboard bridge for all 15 endpoints | Only errors, logs, and HMR matter for agent workflows. Stats is cheap to include for detection. |
| Embedded CLI agent | Claude Code, Codex, Gemini are better agents. Feed them, don't compete. |

---

## 5. Implementation

### Step 1: Dashboard Endpoints

| Task | Files |
|------|-------|
| `/_dev/api/live-errors` endpoint | `src/server/handlers/dev/dashboard/api.ts` (modify) |
| `/_dev/api/live-logs` endpoint | `src/server/handlers/dev/dashboard/api.ts` (modify) |
| `/_dev/api/hmr-trigger` endpoint | `src/server/handlers/dev/dashboard/api.ts` (modify) |

### Step 2: Standalone MCP

| Task | Files |
|------|-------|
| `mcp` subcommand entry point | `src/cli/commands/mcp.ts` (new) |
| MCP server with HTTP pull tools | `src/cli/mcp/standalone.ts` (new) |
| Dev server HTTP client | `src/cli/mcp/dev-server-client.ts` (new) |
| Register in CLI router | `src/cli/index/command-router.ts` (modify) |
| Add `deno task mcp` | `deno.json` (modify) |

### Step 3: Plugin

| Task | Repo |
|------|------|
| Plugin structure + skills + config | `veryfront/claude-plugins` (new repo) |

---

## 6. Success Criteria

| Criteria | Test |
|----------|------|
| `veryfront mcp` starts without dev server | Process stays alive, returns fallback messages |
| Agent sees live errors when dev server runs | `vf_get_errors` returns `ErrorCollector` data |
| Agent sees live logs when dev server runs | `vf_get_logs` returns `LogBuffer` data |
| Agent can trigger HMR | `vf_trigger_hmr` causes browser reload |
| Plugin installs in Claude Code | Tools appear, skills load |

---

## 7. Risks

| Risk | Mitigation |
|------|------------|
| `veryfront` not on PATH | Fallback to `npx veryfront mcp` in plugin config |
| Dev server probe flaky | 500ms timeout, fail open |
| Plugin system changes | Format is simple (JSON + markdown) |

---

## 8. Future (Only If Needed)

- More dashboard bridge tools (metrics, memory, build)
- Production monitoring tools (Loki/Tempo queries)
- Plugins for other agents (if they ship plugin systems)
