---
title: "MCP server"
description: "Expose tools, prompts, and resources over Model Context Protocol."
order: 32
---

Mount an MCP server route in your app to expose your project's tools, prompts,
and resources to MCP clients. The runtime auto-discovers everything under
`tools/`, `prompts/`, and `resources/`; the route owns authentication, protocol
negotiation, and session lifecycle.

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

The handler does not bind a network port. Your application framework owns the
listener and route. The optional `port` configuration is validated metadata for
hosts that choose to use it; `createHTTPHandler()` does not listen on it.

Export only `POST`, `DELETE`, and `OPTIONS`. The built-in handler is a
request/response JSON transport and intentionally returns `405 Method Not
Allowed` for `GET`; it does not expose a standalone SSE stream.

Export a local token and start the dev server:

```bash
export MCP_TOKEN=<TOKEN>
veryfront dev
```

Smoke test the route by sending an MCP `initialize` request and storing the session ID:

```bash
SESSION_ID=$(curl -i http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0.0.0"}}}' \
  | awk -F': ' 'tolower($1) == "mcp-session-id" {print $2}' \
  | tr -d '\r')
```

The response includes a `MCP-Session-Id` header and a JSON-RPC result with server capabilities.

### Auth is required

`auth` is a required field. The server fails closed at construction time if it
is missing or malformed. Options:

- `{ type: "bearer", validate }` (required for a usable production endpoint):
  validates a bearer token against your own logic. A bearer configuration
  without `validate` remains constructible for compatibility, but rejects every
  request.
- `{ type: "none", allowUnauthenticated: true }`: **local development only**.
  Must be set explicitly; accepts every request without any check. Do not ship
  this to production.

The HTTP transport is session-based:

- clients `POST` `initialize`
- the server returns `MCP-Session-Id`
- subsequent requests send that header and the negotiated
  `MCP-Protocol-Version` back
- `DELETE` with both headers ends the session

A bearer-authenticated session is bound to the credential that initialized it.
Use the same bearer token on every request and when deleting the session.
Presenting another token produces the same not-found response as an unknown
session.

Do not use caller-supplied identity headers such as `X-Project-Id` or
`X-End-User-Id` as authorization context. The built-in handler ignores them.
If tools require tenant or end-user identity, resolve it in a trusted
application boundary and use a custom host integration that passes a trusted
execution context.

When browser clients send an `Origin` header, configure an exact, canonical
HTTP(S) allowlist:

```ts
const server = createMCPServer({
  enabled: true,
  auth: {
    type: "bearer",
    validate: async (token) => token === Deno.env.get("MCP_TOKEN"),
  },
  cors: {
    enabled: true,
    origins: ["https://app.example.com"],
  },
});
```

Without an explicit allowlist, browser origins are restricted to canonical
loopback HTTP(S) origins. Non-browser clients that omit `Origin` remain
supported.

## Tools

Tools defined in `tools/` are automatically available via MCP:

```ts
// tools/search-docs.ts
import { defineSchema } from "veryfront/schemas";
import { tool } from "veryfront/tool";

export default tool({
  description: "Search the documentation",
  inputSchema: defineSchema((v) =>
    v.object({
      query: v.string().describe("Search query"),
      limit: v.number().default(10).describe("Max results"),
    })
  )(),
  execute: async ({ query, limit }) => {
    const results = await searchIndex(query, limit);
    return { results };
  },
});
```

An MCP client can discover this tool's schema and call it.

List methods return at most 50 entries. When a response contains
`nextCursor`, pass it back as `params.cursor`; cursors are opaque and belong to
the server instance, list method, and session that issued them.

Protocol version `2025-11-25` clients can request task-augmented tool execution
and use `tasks/get`, `tasks/list`, `tasks/result`, and `tasks/cancel`. Tasks are
isolated to the session that created them. The server bounds retained tasks and
may reject new task work when capacity is exhausted, so clients should retrieve
terminal results promptly.

Closing an HTTP connection is not an MCP cancellation. Send
`notifications/cancelled` for an in-flight request or `tasks/cancel` for a
task. Deleting the session cancels and removes its outstanding work.

## Prompts

Prompts defined in `prompts/` are exposed as MCP prompt templates:

```ts
// prompts/code-review.ts
import { prompt } from "veryfront/prompt";

export default prompt({
  description: "Review code for quality issues",
  mcp: {
    title: "Code review",
    arguments: [{
      name: "code",
      title: "Source code",
      description: "Code to review",
      required: true,
    }],
  },
  content: `Review the following code for:
- Security vulnerabilities
- Performance issues
- Code style problems

Code to review:
{code}`,
});
```

MCP prompt argument values are strings. If `arguments` metadata is present,
the server rejects undeclared arguments and enforces every required argument.
Application code calling `getContent()` directly is not limited to strings.

Set `mcp: { enabled: false }` to keep a prompt available to application code
without listing or serving it over MCP. Nested prompt files retain their
relative namespace: `prompts/admin/review.ts` is listed as `admin/review`.

Generated prompts receive MCP cancellation through the optional render
context:

```ts
export default prompt({
  description: "Build a report",
  generate: async ({ topic }, context) => {
    const response = await fetchReport(String(topic), {
      signal: context?.abortSignal,
    });
    return response.text();
  },
});
```

The server returns promptly after a cancellation notification. The generator
must still honor the signal to stop its own I/O and side effects.

## Resources

Resources are data sources that MCP clients can read:

```ts
// resources/docs.ts
import { defineSchema } from "veryfront/schemas";
import { resource } from "veryfront/resource";

export default resource({
  description: "Project documentation",
  pattern: "docs://project",
  paramsSchema: defineSchema((v) => v.object({}))(),
  load: async () => {
    const docs = await loadDocs();
    return { contents: docs };
  },
});
```

Set `mcp: { enabled: false }` when application code should still be able to
load a resource but MCP clients must not list or read it.

Without an `mcp.content` setting, the loader result must be bounded JSON. To
serve text, declare its media type and return a string:

```ts
export default resource({
  description: "Project README",
  pattern: "docs://readme",
  paramsSchema: defineSchema((v) => v.object({}))(),
  mcp: {
    content: { type: "text", mimeType: "text/markdown" },
  },
  load: () => "# Project\n",
});
```

To serve binary content, use `type: "blob"` with a media type and return a
`Uint8Array`. The MCP server base64-encodes the bytes. JSON and text content
fields are limited to four mebibytes. Blob inputs are limited to three
mebibytes so the encoded field remains within four mebibytes.

Parameterized URI segments do not absorb raw `?` or `#` delimiters. Percent-
encode a reserved delimiter when it belongs inside a parameter value. Resource
patterns and requested URIs are limited to 8,192 characters and reject raw
whitespace and control characters.

Resource descriptions are limited to 16,384 characters, titles to 1,024
characters, and definition IDs to 8,192 characters. MCP configuration objects
are strict: unknown fields are rejected when the resource is constructed or
registered.

Loaders receive MCP cancellation through the optional read context:

```ts
export default resource({
  description: "Project documentation",
  pattern: "docs://project",
  paramsSchema: defineSchema((v) => v.object({}))(),
  load: async (_params, context) => {
    return await loadDocs({ signal: context?.abortSignal });
  },
});
```

The server returns promptly after a cancellation notification. Honor the
signal in loader I/O to release the underlying work.

## Elicitation

Use `buildFormElicitation()` only with the flat primitive schema supported by
MCP `2025-11-25`: a root object whose properties are strings, finite
numbers/integers, booleans, or single- and multi-select string enums. Nested
objects and unsupported JSON Schema keywords are rejected before a request is
sent.

Use `buildUrlElicitation()` for sensitive or out-of-band flows. Supply an
absolute HTTP(S) URL and a stable elicitation ID, and verify the returned state
inside the trusted application flow.

## Manual registration

For tools, prompts, or resources not in the auto-discovered directories:

```ts
import { defineSchema } from "veryfront/schemas";
import { registerTool } from "veryfront/mcp";
import { tool } from "veryfront/tool";

registerTool(
  "custom-tool",
  tool({
    description: "A custom tool",
    inputSchema: defineSchema((v) =>
      v.object({
        input: v.string().describe("Text to transform"),
      })
    )(),
    execute: async ({ input }) => ({ result: input.toUpperCase() }),
  }),
);
```

## Transport note

This guide is about the application-facing MCP server from `veryfront/mcp`.

It is not the same surface as the CLI development server started with `veryfront mcp`, which exposes Veryfront development/runtime tools rather than your app's MCP route.

The built-in Streamable HTTP transport does not advertise
`tools.listChanged`, `resources.listChanged`, or `prompts.listChanged`.
Registry mutations are not pushed as server-initiated notifications on that
transport; reconnect or list again after an application reload. The
`notifyToolsChanged()`, `notifyResourcesChanged()`, and
`notifyPromptsChanged()` methods are available only for custom transports that
explicitly wire a notification callback.

The built-in HTTP transport enforces initialization and sessions. Calling
`MCPServer.handleRequest()` directly is a compatibility surface for custom
transports; that transport is responsible for JSON-RPC envelope validation,
initialization ordering, session isolation, authentication, and protocol
headers.

## Verify it worked

Use any MCP-aware client (Claude Desktop, an MCP CLI, or `curl`) to call the
`tools/list` method:

```bash
SESSION_ID=$(curl -i http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0.0.0"}}}' \
  | awk -F': ' 'tolower($1)=="mcp-session-id"{gsub(/\r/,"",$2); print $2}')

curl -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $MCP_TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Session-Id: $SESSION_ID" \
  -H "MCP-Protocol-Version: 2025-11-25" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'
```

A working server returns a JSON-RPC response with the first page of registered
tools.
Calling without the bearer token returns `401 Unauthorized`.
