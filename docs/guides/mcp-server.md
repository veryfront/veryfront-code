---
title: "MCP server"
description: "Expose tools, prompts, and resources over Model Context Protocol."
order: 23
---

Mount an MCP server route in your app to expose your project's tools, prompts, and resources to MCP clients like Claude Desktop. The runtime auto-discovers everything under `tools/`, `prompts/`, and `resources/`, so the route handler is essentially a thin auth shim.

This is the application-facing MCP server. It is separate from `veryfront mcp` (the CLI's dev MCP server, see [Coding agents](./coding-agents.md)) and from the AG-UI transport Veryfront Studio uses.

## Prerequisites

- A Veryfront project with tools, prompts, or resources you want to expose
  (see [Tools](./tools.md)).
- A way to mint bearer tokens for MCP clients (a static `MCP_TOKEN` env var
  is fine in development).

## Setup

```ts
// app/api/mcp/route.ts
import { createMCPServer } from "veryfront/mcp";

const server = createMCPServer({
  enabled: true,
  auth: {
    type: "bearer",
    validate: async (token) => token === Deno.env.get("MCP_TOKEN"),
  },
});
const handler = server.createHTTPHandler();

export const POST = handler;
export const DELETE = handler;
export const OPTIONS = handler;
```

Mount the handler on your application-owned MCP route. All auto-discovered tools, prompts, and resources are then exposed through the app-facing MCP transport.

Start the dev server with a local token:

```bash
MCP_TOKEN=dev-token veryfront dev
```

Smoke test the route by sending an MCP `initialize` request:

```bash
curl -i http://localhost:3000/api/mcp \
  -H "Authorization: Bearer dev-token" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0.0.0"}}}'
```

The response should include a `MCP-Session-Id` header and a JSON-RPC result with server capabilities.

### Auth is required

`auth` is a required field. The server fails closed at construction time if
it is missing. Options:

- `{ type: "bearer", validate }` (recommended for production): validates a
  bearer token against your own logic.
- `{ type: "none", allowUnauthenticated: true }`: **local development only**.
  Must be set explicitly; accepts every request without any check. Do not ship
  this to production.

The HTTP transport is session-based:

- clients `POST` `initialize`
- the server returns `MCP-Session-Id`
- subsequent requests send that header back
- `DELETE` with the session header ends the session

## Tools

Tools defined in `tools/` are automatically available via MCP:

```ts
// tools/search-docs.ts
import { z } from "zod";
import { tool } from "veryfront/tool";

export default tool({
  description: "Search the documentation",
  inputSchema: z.object({
    query: z.string().describe("Search query"),
    limit: z.number().default(10).describe("Max results"),
  }),
  execute: async ({ query, limit }) => {
    const results = await searchIndex(query, limit);
    return { results };
  },
});
```

An MCP client can discover this tool's schema and call it.

## Prompts

Prompts defined in `prompts/` are exposed as MCP prompt templates:

```ts
// prompts/code-review.ts
import { prompt } from "veryfront/prompt";

export default prompt({
  description: "Review code for quality issues",
  content: `Review the following code for:
- Security vulnerabilities
- Performance issues
- Code style problems

Code to review:
{{code}}`,
});
```

## Resources

Resources are data sources that MCP clients can read:

```ts
// resources/docs.ts
import { resource } from "veryfront/resource";

export default resource({
  description: "Project documentation",
  pattern: "docs://project",
  load: async () => {
    const docs = await loadDocs();
    return { contents: docs };
  },
});
```

## Manual registration

For tools, prompts, or resources not in the auto-discovered directories:

```ts
import { z } from "zod";
import { registerTool } from "veryfront/mcp";
import { tool } from "veryfront/tool";

registerTool(
  "custom-tool",
  tool({
    description: "A custom tool",
    inputSchema: z.object({ input: z.string() }),
    execute: async ({ input }) => ({ result: input.toUpperCase() }),
  }),
);
```

## Transport note

This guide is about the application-facing MCP server from `veryfront/mcp`.

It is not the same surface as the CLI development server started with `veryfront mcp`, which exposes Veryfront development/runtime tools rather than your app's MCP route.

## Verify it worked

Use any MCP-aware client (Claude Desktop, an MCP CLI, or `curl`) to call the
`tools/list` method:

```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

A working server returns a JSON-RPC response that lists every registered
tool. Calling without the bearer token should return `401 Unauthorized`.

## Next

- [Configuration](./configuration.md): framework configuration options
- [Tools](./tools.md): define the tools MCP exposes

## Related

- [`veryfront/mcp`](../reference/veryfront/mcp.md): MCP server API reference
- [`veryfront/tool`](../reference/veryfront/tool.md): tool API reference
- [`veryfront/prompt`](../reference/veryfront/prompt.md): prompt API reference
- [`veryfront/resource`](../reference/veryfront/resource.md): resource API reference
