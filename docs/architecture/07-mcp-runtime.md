# MCP runtime

This page describes the MCP server runtime. It does not cover AG-UI transport or
agent browser streaming.

## Responsibility

The MCP runtime exposes tools, resources, prompts, session handling, elicitation,
SSE, HTTP transport, and task storage through the Model Context Protocol.

Primary source areas:

- [`src/mcp/server.ts`](../../src/mcp/server.ts)
- [`src/mcp/http-transport.ts`](../../src/mcp/http-transport.ts)
- [`src/mcp/sse.ts`](../../src/mcp/sse.ts)
- [`src/mcp/session.ts`](../../src/mcp/session.ts)
- [`src/mcp/registry.ts`](../../src/mcp/registry.ts)
- [`src/mcp/task-store.ts`](../../src/mcp/task-store.ts)

## Runtime flow

1. `createMCPServer` registers server metadata, tools, resources, prompts, and
   integration loaders.
2. HTTP transport converts requests into JSON-RPC messages.
3. Session handling records client capabilities and session-scoped support such
   as elicitation.
4. Registry dispatch calls the selected tool, resource, or prompt handler.
5. SSE and task store helpers support streamed and long-running MCP operations.

## Boundaries

- MCP is a tool and resource protocol surface. It is not the AG-UI browser
  stream.
- Agent runtime may use MCP tools, but MCP does not own agent message execution.
- Control-plane signed channel handling belongs in [control-plane channels](./09-control-plane-channels.md).

## Change checks

- Keep JSON-RPC responses schema-valid.
- Preserve session behavior when changing elicitation or SSE support.
- Add tests in `src/mcp/*.test.ts` for protocol-visible behavior.
