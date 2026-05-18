# MCP runtime

This page describes the MCP server runtime. It does not cover AG-UI transport,
agent browser streaming, or the shape of tool, prompt, and resource
definitions.

## Responsibility

The MCP runtime is a transport surface. It exposes the tool, prompt, and
resource primitives defined by the agent runtime as Model Context Protocol
artifacts and handles session handling, elicitation, SSE, HTTP transport, and
task storage. Primitive shape, factories, schemas, and registries belong to
[agent runtime](./05-agent-runtime.md).

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
- The agent runtime owns primitive definitions, registries, and tool
  execution; see [agent runtime](./05-agent-runtime.md).
- Agent runtime may use MCP tools, but MCP does not own agent message execution.
- Control-plane signed channel handling belongs in [control-plane channels](./11-control-plane-channels.md).

## Change checks

- Keep JSON-RPC responses schema-valid.
- Preserve session behavior when changing elicitation or SSE support.
- Add tests in `src/mcp/*.test.ts` for protocol-visible behavior.

## Related guides

- [MCP server](../guides/mcp-server.md)

## Related reference

- [`veryfront/mcp`](../reference/veryfront/mcp.md)
