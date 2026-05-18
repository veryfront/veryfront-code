# Control-plane channels

This page describes signed control-plane and invoke channels. It does not cover
MCP server protocol handling or browser AG-UI chunk encoding.

## Responsibility

Control-plane channels move signed management requests between Veryfront
services and project runtimes.

Project runtimes expose these signed control-plane paths:

| Path                                         | Purpose                                                   |
| -------------------------------------------- | --------------------------------------------------------- |
| `POST /api/control-plane/agents/list`        | List project agents available to the control plane.       |
| `POST /api/control-plane/runs/:runId/stream` | Invoke a project agent run with a signed runtime request. |
| `POST /api/control-plane/runs/:runId/resume` | Resume a waiting project agent run.                       |
| `DELETE /api/control-plane/runs/:runId`      | Cancel a project agent run.                               |

Primary source areas:

- [`src/channels/control-plane.ts`](../../src/channels/control-plane.ts)
- [`src/channels/invoke.ts`](../../src/channels/invoke.ts)
- [`src/server/handlers/request/channel-dispatch-request.ts`](../../src/server/handlers/request/channel-dispatch-request.ts)
- [`src/server/handlers/request/channel-invoke.handler.ts`](../../src/server/handlers/request/channel-invoke.handler.ts)

## Runtime flow

1. A trusted service signs a channel request.
2. The project runtime validates the signature and request shape.
3. Dispatch handlers route the request to the intended control-plane operation.
4. Invoke handlers execute project-scoped runtime work and return structured
   results.

## Boundaries

- Control-plane channels are signed management surfaces, not public app routes.
- `POST /api/ag-ui` is the public AG-UI transport adapter.
- `/api/runs*` is the sibling run-control API for hosted runtime lifecycle
  operations.
- Conversation-scoped run APIs in Veryfront API provide run lineage, read, and
  replay for conversation-attached runs.
- AG-UI event encoding belongs in [AG-UI transport](./06-ag-ui-transport.md).
- MCP JSON-RPC dispatch belongs in [MCP runtime](./10-mcp-runtime.md).

## Change checks

- Preserve signature validation before any dispatch.
- Keep public app route handlers separate from control-plane handlers.
- Add tests for invalid signatures, malformed payloads, and successful dispatch
  paths when changing channel behavior.

## Related guides

- [Agent service runtime](../guides/agent-service-runtime.md)

## Related reference

- [`veryfront/agent/conversation-control-plane`](../reference/veryfront/agent.md)
- [`veryfront/agent/service-runtime`](../reference/veryfront/agent.md)
