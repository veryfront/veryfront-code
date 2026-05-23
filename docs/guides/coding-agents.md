---
title: "Coding agents"
description: "Connect Claude Code, Cursor, Codex, and other MCP-aware coding agents to the Veryfront dev server."
order: 33
---

Connect Claude Code, Cursor, Codex, or any MCP-aware coding agent to your Veryfront dev server. The agent gets a focused dev toolset: live errors and logs, route listing, route preview, scaffolding, test and lint runners.

This is the CLI's built-in MCP server. It is separate from the application-facing MCP server (see [MCP server](./mcp-server.md)), which exposes _your_ tools to MCP clients. The CLI MCP exposes _Veryfront dev tools_ to your coding agent.

## Prerequisites

- A Veryfront project (see [Create a project](../getting-started/create-a-project.md)).
- An MCP-aware coding agent such as Claude Code, Cursor, or any client that
  speaks Model Context Protocol over HTTP or stdio.

## Choose a transport

The CLI MCP server supports two transports. Most agents work with HTTP.

| Transport | When to use it                                                    | How to start                        |
| --------- | ----------------------------------------------------------------- | ----------------------------------- |
| HTTP      | Your agent supports remote MCP URLs (Claude Code, Cursor, Codex). | Auto-starts with `veryfront dev`.   |
| stdio     | Your agent only supports stdio MCP servers.                       | Run `veryfront mcp` from the agent. |

When you run `veryfront dev`, the HTTP MCP server listens on `--port + 2` (default `3002`). When you run `veryfront start`, it listens on `9999`. The endpoint is always `/mcp`.

```
http://localhost:3002/mcp        # dev
http://localhost:9999/mcp        # production
```

The dev server also accepts the `veryfront.me` hostname, which resolves to `127.0.0.1` and is what the CLI prints by default.

## Connect Claude Code

Add an `mcpServers` entry in `~/.claude.json`:

```json
{
  "mcpServers": {
    "veryfront": {
      "url": "http://veryfront.me:3002/mcp"
    }
  }
}
```

Restart Claude Code, then run `veryfront dev` in your project. Claude Code discovers the Veryfront tools and prefixes them with `mcp__veryfront__` in its tool list.

## Connect Cursor

Open Cursor settings, find the **Model Context Protocol** section, and add a new server with:

- **Name:** `veryfront`
- **URL:** `http://localhost:3002/mcp`
- **Transport:** HTTP

Save and reload. Cursor's agent can now call Veryfront tools while you edit.

## Connect Codex (or any other MCP-aware client)

For any MCP-aware client that supports HTTP transport, point it at `http://localhost:3002/mcp` while `veryfront dev` is running. The CLI also exposes a stdio MCP server, so clients that require stdio can launch it as a subprocess:

```bash
veryfront mcp
```

The stdio transport reads JSON-RPC requests on `stdin` and writes responses on `stdout`. Agents that only accept a command path can use the binary that `npm install -g veryfront` puts on `PATH`.

## What the agent can do

The CLI MCP exposes a focused toolset for the development loop. The names below are stable and prefix-namespaced with `vf_`:

| Tool                     | What it does                                                 |
| ------------------------ | ------------------------------------------------------------ |
| `vf_get_errors`          | Read live compile, runtime, bundle, HMR, and module errors.  |
| `vf_get_logs`            | Read dev-server logs with level, source, and pattern filter. |
| `vf_get_status`          | Inspect dev-server uptime, ports, and active features.       |
| `vf_list_routes`         | List every route the dev server has registered.              |
| `vf_preview_route`       | Render a route's HTTP response without opening a browser.    |
| `vf_scaffold`            | Generate a page, API route, component, tool, or agent.       |
| `vf_run_tests`           | Run the project's test suite.                                |
| `vf_run_lint`            | Run the linter.                                              |
| `vf_trigger_hmr`         | Force a browser refresh after an external file change.       |
| `vf_list_templates`      | Browse the templates `veryfront init` supports.              |
| `vf_list_integrations`   | Browse the available integration connectors.                 |
| `vf_create_project`      | Bootstrap a new project from a template.                     |
| `vf_list_local_projects` | Find Veryfront projects on the filesystem.                   |

For the full toolset and current argument shapes, call `vf_get_schema` from the agent (or run `veryfront schema --json` from your shell). That command is the source of truth and stays in sync with the CLI you have installed.

## Verify it worked

Start the dev server:

```bash
veryfront dev
```

Smoke-test the MCP endpoint with a `tools/list` request:

```bash
curl -s -X POST http://localhost:3002/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | head -c 500
```

A working server returns a JSON-RPC response whose `result.tools` array lists `vf_get_errors`, `vf_scaffold`, and the other tools above. If you get a connection-refused error, the dev server is not running or is on a non-default port; check the dashboard for the printed MCP URL.

From inside a connected coding agent, ask it to "list routes" or "show recent dev errors". It should call the matching `vf_*` tool and stream the result back as text.

## Troubleshooting

### The agent does not see Veryfront tools

The dev server must be running. The HTTP MCP only listens while `veryfront dev` or `veryfront start` is active.

### Port already in use

The dev MCP port follows the dev server port (`--port + 2`). If you start the dev server with `--port 4000`, the MCP server moves to `4002`. Update the URL in your agent config to match.

### CORS error from a browser-based agent

The HTTP MCP only accepts requests from `localhost`, `127.0.0.1`, and `veryfront.me`. Browser agents that run from any other origin are rejected by design.

### `Unknown command: mcp`

Your installed CLI is older than the version that added MCP. Update with `npm install -g veryfront@latest`, or run from source:

```bash
cd veryfront-code
deno run -A cli/main.ts mcp
```

## Next

- [MCP server](./mcp-server.md): expose _your_ app's tools, prompts, and resources to MCP clients
- [Skills](./skills.md): give agents project-level instructions as `SKILL.md` files
- [Create a project](../getting-started/create-a-project.md): scaffold a project the agent can drive

## Related

- [`veryfront/mcp`](../api-reference/veryfront/mcp.md): MCP server API reference
- [`veryfront/cli`](../api-reference/veryfront/cli.md): CLI entry point reference
