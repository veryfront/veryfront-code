# MCP runtime

This page describes the MCP server runtime. It does not cover AG-UI transport,
agent browser streaming, or the shape of tool, prompt, and resource
definitions.

## Responsibility

The MCP runtime is a protocol boundary. It exposes the tool, prompt, and
resource primitives defined by the agent runtime as Model Context Protocol
artifacts and owns protocol negotiation, HTTP admission, session isolation,
elicitation, SSE serialization helpers, pagination, and task storage.
Primitive shape, factories, schemas, and registries belong to
[agent runtime](./05-agent-runtime.md).

Primary source areas:

- [`src/mcp/server.ts`](../../src/mcp/server.ts)
- [`src/mcp/http-transport.ts`](../../src/mcp/http-transport.ts)
- [`src/mcp/protocol.ts`](../../src/mcp/protocol.ts)
- [`src/mcp/sse.ts`](../../src/mcp/sse.ts)
- [`src/mcp/session.ts`](../../src/mcp/session.ts)
- [`src/mcp/registry.ts`](../../src/mcp/registry.ts)
- [`src/mcp/task-store.ts`](../../src/mcp/task-store.ts)

## Runtime flow

1. `createMCPServer` snapshots and validates server configuration, then uses
   the application registries for tools, resources, and prompts.
2. The HTTP boundary validates Origin, authentication, content type, body
   bounds, the JSON-RPC envelope, initialization order, and the negotiated
   protocol version before refreshing a session.
3. Successful initialization creates a bounded session and records a snapshot
   of client capabilities, the negotiated protocol version, and a one-way
   bearer-credential binding.
4. Registry dispatch validates and snapshots protocol-visible metadata before
   invoking the selected tool, resource, or prompt handler.
5. List operations page through at most 50 entries using opaque cursors bound
   to the server instance, method, and session.
6. For protocol `2025-11-25`, task-backed tool calls use a session-scoped
   bounded task store. Explicit request cancellation, task cancellation, or
   session deletion aborts owned work and releases session state.

The runtime recognizes `2025-11-25` and the compatibility version
`2024-11-05`. `src/mcp/protocol.ts` is the shared source of truth for
negotiation and HTTP header validation. Task capabilities and methods are
available only to `2025-11-25` sessions.

## HTTP trust boundary

The built-in handler is a request/response JSON transport. It serves `POST`,
`DELETE`, and `OPTIONS`; `GET` returns `405` because the handler does not own a
standalone SSE stream. `formatSSEEvent` remains available to custom transports
and rejects values that cannot be serialized safely.

Authentication fails closed. Bearer validation must return the boolean value
`true`, and a bearer configuration without a validator rejects all requests.
Every authenticated session is bound to the credential used during
initialization. The runtime compares a one-way binding rather than retaining
the token itself.

Origin admission is independent of CORS response headers. Configured origins
must be exact canonical HTTP(S) origins. Without an explicit allowlist, only
canonical loopback browser origins are admitted; clients without an `Origin`
header are allowed. Rejected authentication, Origin, and protocol-version
requests do not extend session lifetime.

Caller-controlled project and end-user headers are not execution authority.
The built-in handler supplies no tenant context. A host that needs project or
user identity must establish it at a trusted boundary and use a transport
integration that passes a trusted `ToolExecutionContext`.

An HTTP disconnect is not an MCP cancellation and is deliberately not
forwarded as a tool, resource, prompt, or task signal. Clients cancel work with
`notifications/cancelled` or `tasks/cancel`; deleting a session aborts all
foreground requests and tasks owned by that session.

`createHTTPHandler()` creates a handler but does not bind a socket. The
application host owns routing and listening; `port` is validated configuration
metadata, not an instruction to start a listener.

## Capacity and lifetime

The session manager admits at most 1,024 live sessions and expires inactive
sessions after 30 minutes. Removing a session clears its capabilities,
protocol and credential bindings, pending requests, and tasks.

The task store admits at most 100 tasks per session and 1,000 tasks globally.
Task records and results are defensively snapshotted. `tasks/result` waits
without polling and is abortable through the explicit MCP cancellation paths.
Terminal records may remain available for their configured retention window;
capacity pressure evicts eligible terminal work before rejecting new tasks.

## Elicitation boundary

Form elicitation implements the flat primitive `2025-11-25` schema subset.
The root must be an object; properties may be strings, finite
numbers/integers, booleans, or supported single- and multi-select string
enums. Bounds, formats, defaults, required names, and allowed keywords are
checked before dispatch. Nested objects and unsupported schema extensions fail
closed. URL elicitation accepts bounded absolute HTTP(S) URLs and stable,
bounded identifiers.

## Boundaries

- MCP is a tool and resource protocol surface. It is not the AG-UI browser
  stream.
- The agent runtime owns primitive definitions, registries, and tool
  execution; see [agent runtime](./05-agent-runtime.md).
- Agent runtime may use MCP tools, but MCP does not own agent message execution.
- Control-plane signed channel handling belongs in [control-plane channels](./11-control-plane-channels.md).
- The built-in HTTP transport owns envelope, initialization, authentication,
  protocol-header, and session enforcement. Direct `MCPServer.handleRequest()`
  calls remain a compatibility surface; custom transports must supply those
  controls themselves.
- Initialization tolerates omitted legacy client metadata and negotiates the
  latest supported version for backward compatibility. HTTP clients should
  still send the complete MCP initialization shape.

## Change checks

- Keep JSON-RPC responses schema-valid.
- Preserve session behavior when changing elicitation or SSE support.
- Verify that rejected requests cannot refresh or cross session scope.
- Preserve explicit MCP cancellation semantics; do not treat transport
  disconnect as cancellation.
- Add tests in `src/mcp/*.test.ts` for protocol-visible behavior.

## Related guides

- [MCP server](../guides/mcp-server.md)

## Related reference

- [`veryfront/mcp`](../api-reference/veryfront/mcp.md)
