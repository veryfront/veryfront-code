---
title: "MCP server"
description: "Expose tools, prompts, and resources over Model Context Protocol."
order: 23
---

# MCP server

Expose tools, prompts, and resources over Model Context Protocol.

This guide covers the application-facing MCP server exposed by `veryfront/mcp`. It is separate from the internal AG-UI transport used by Veryfront Studio and internal agent control-plane flows.

## Setup

```ts
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

## Next

- [Configuration](./configuration.md): framework configuration options
- [Tools](./tools.md): define the tools MCP exposes

## Related

- [`veryfront/mcp`](../reference/mcp.md): MCP server API reference
- [`veryfront/tool`](../reference/tool.md): tool API reference
- [`veryfront/prompt`](../reference/prompt.md): prompt API reference
- [`veryfront/resource`](../reference/resource.md): resource API reference
