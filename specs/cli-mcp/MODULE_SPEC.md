# cli/mcp — Behavioral NLSpec

## Purpose

Exposes the Veryfront dev server and project management functionality via
the **Model Context Protocol (MCP)**. Two server variants exist:

1. **MCPDevServer** — embedded inside the running dev server process;
   communicates over stdio and/or HTTP.
2. **StandaloneMCPServer** — runs as a separate `veryfront mcp` process;
   communicates over stdio only and pulls runtime data from the dev
   server's Dashboard API over HTTP (via `DevServerClient`).

## Public API Surface

### Exports (via `index.ts`)

- `MCPDevServer`, `MCPServerConfig`, `createMCPServer` — from `server.ts`
- `allTools`, `getTool`, `listTools`, `setServerStartTime`, individual tool
  constants (`vfGetErrors`, `vfGetLogs`, etc.) — from `tools.ts`
- Re-exports from `veryfront/observability` (error collector, log buffer)

### Standalone (not re-exported from index)

- `StandaloneMCPServer`, `StandaloneMCPConfig`, `createStandaloneMCPServer`
  — from `standalone.ts`

## Module Structure

```
cli/mcp/
  index.ts               — barrel re-exports from server.ts and tools.ts
  server.ts              — MCPDevServer class (stdio + HTTP transports)
  standalone.ts          — StandaloneMCPServer class (stdio only, HTTP client)
  stdio.ts               — generic newline-delimited JSON-RPC read loop
  jsonrpc.ts             — JSON-RPC 2.0 types, schemas, response builders
  tools.ts               — core tool registry (errors, logs, cache, status)
  advanced-tools.ts      — aggregates tool groups from tools/ subdirectory
  remote-file-tools.ts   — REST API tools for remote project file management
  dev-server-client.ts   — HTTP client for Dashboard API (standalone mode)
  tools/
    helpers.ts           — shared types and utilities for tool implementations
    dev-tools.ts         — HMR, preview, debug, flywheel tools
    project-tools.ts     — route scanning, project context, component tree
    scaffold-tools.ts    — code generation scaffolding and conventions
    skill-tools.ts       — agent skill discovery and reference loading
    catalog-tools.ts     — examples, templates, integrations, use-cases
  skills/                — markdown skill files (SKILL.md + references/)
```

## Behavioral Contracts

### MCPDevServer

- **Constructor** accepts optional `MCPServerConfig`; defaults
  `serverName` to `"veryfront-dev"` and `serverVersion` to `"1.0.0"`.
  Records server start time on construction.
- **start()** is idempotent. When `config.stdio` is true, starts a
  newline-delimited JSON-RPC loop on stdin/stdout. When `config.httpPort`
  is set, binds an HTTP server on that port.
- **stop()** tears down both transports; idempotent and safe to call
  without prior `start()`.
- **HTTP endpoint** is `POST /mcp`; returns 404 for other paths, 405 for
  non-POST methods, 204 for CORS preflight. CORS allows localhost,
  127.0.0.1, and veryfront.me origins.
- **MCP methods**: `initialize`, `tools/list`, `tools/call`,
  `resources/list`, `resources/read`, `prompts/list`, `prompts/get`.
  Unknown methods return a JSON-RPC error.
- **Resources**: `veryfront://skill` (SKILL.md content),
  `veryfront://errors` (ErrorCollector), `veryfront://logs` (LogBuffer),
  `issues://` (IssuesManager list), `issues://{id}` (single issue).
- **Prompts**: `veryfront`, `veryfront-routing`, `veryfront-ai-tools`,
  `veryfront-components`, `flywheel` — each loads a markdown file from
  `skills/`.
- **zodToJsonSchema** converts Zod schemas to JSON Schema for tool
  `inputSchema` serialisation; handles Object, String, Number, Boolean,
  Array, Enum, Optional, Default, Nullable, Literal, Union, Record types.

### StandaloneMCPServer

- Communicates over stdio only.
- Creates a `DevServerClient` to fetch errors, logs, status, and trigger
  HMR from the running dev server's Dashboard API.
- Falls back with `{ error: "Dev server not running..." }` when the dev
  server is unreachable.
- Exposes four tools: `vf_get_errors`, `vf_get_logs`, `vf_get_status`,
  `vf_trigger_hmr`.
- Exposes two prompts: `veryfront`, `flywheel`.

### DevServerClient

- Wraps `fetch` calls to `http://localhost:{port}/_dev/api/*` endpoints.
- Retries up to 2 times with 200ms and 500ms delays.
- Throws after exhausting retries.

### Tool Registry (tools.ts)

- `allTools` array is the union of `advancedTools`, `remoteFileTools`,
  `issuesMcpTools`, and five core tools (`vfGetErrors`, `vfGetLogs`,
  `vfClearCache`, `vfGetStatus`, `vfClearErrors`).
- `getTool(name)` returns the first tool matching by name, or `undefined`.
- `listTools()` returns `{ name, description }` summaries for all tools.
- Tool names are unique across the entire registry.

### Advanced Tools (tools/ subdirectory)

- **dev-tools**: `vf_hot_reload`, `vf_get_debug_context`, `vf_trigger_hmr`,
  `vf_preview_route`, `vf_wait_for_ready`, `vf_get_flywheel_status`
- **project-tools**: `vf_list_routes`, `vf_get_project_context`,
  `vf_get_component_tree`, `vf_list_local_projects`
- **scaffold-tools**: `vf_scaffold`, `vf_get_conventions`
- **skill-tools**: `vf_get_skills`, `vf_get_skill_reference`
- **catalog-tools**: `vf_list_examples`, `vf_list_templates`,
  `vf_list_integrations`, `vf_list_usecases`, `vf_create_project`

### Remote File Tools

- 12 tools for CRUD on remote project files and branches via the
  Veryfront REST API.
- Authenticated via `VERYFRONT_API_TOKEN`.
- Project creation retries with random slug suffix on 409 conflict
  (up to 10 attempts).

### stdio.ts

- Generic newline-delimited JSON-RPC transport.
- Reads from stdin, parses each line as JSON, delegates to
  `parseRequest` and `handleRequest` callbacks, writes responses to
  stdout.
- Returns the `StdinReader` so callers can release the lock on shutdown.

### jsonrpc.ts

- Defines `JSONRPCRequestSchema` (Zod), `JSONRPCResponse` interface.
- Provides `successResponse`, `errorResponse`, `parseError` builders.
- Standard error codes: PARSE_ERROR, INVALID_REQUEST, METHOD_NOT_FOUND,
  INVALID_PARAMS, INTERNAL_ERROR.
- Validation schemas for `tools/call`, `prompts/get`, `resources/read`
  params.
