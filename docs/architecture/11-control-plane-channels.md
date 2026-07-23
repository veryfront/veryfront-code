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
2. The project runtime caps the request body, then validates the signature and
   request shape.
3. Dispatch handlers route the request to the intended control-plane operation.
4. Invoke handlers execute project-scoped runtime work and return structured
   results.

## Request trust

The runtime verifies Ed25519 compact JWS signatures before dispatch. Verification
binds the signature to the exact request body, project audience, project
identifier, and request identifier. Channel invokes also bind the signature
subject and platform to the parsed payload. A valid signature for one payload
cannot authorize another payload.

Signature timestamps must form a valid window. Runtime dispatch handlers accept
signatures issued within the configured 60 second age limit and reject expired
or future-issued signatures. Signature-only trust checks are not authorization.
The proxy accepts dispatch signatures only for `/channels/invoke` and
control-plane signatures only for their control-plane route family. Any handler
that consumes a payload must use the body-bound verifier.

Verification and payload failures return generic responses. Runtime logs record
the error class and classification, but do not record signed payloads, raw
provider errors, stack traces, project identifiers, or account identifiers.

## Resource and execution limits

The shared dispatch reader rejects request bodies larger than 128 KiB before
signature verification. Channel schemas also bound identifiers, conversation
history, message parts, attachments, metadata, agent lists, skills, and response
parts. Invalid or oversized agent output fails closed as a non-retryable runtime
error.

The request abort signal propagates to agent generation. This allows client
disconnects and server cancellation to stop provider work instead of leaving it
detached. Tool failures return a stable redacted result instead of provider or
tool exception text.

Channel invokes run the supplied conversation history with isolated agent
memory. They do not read, write, or clear the registered agent's configured
memory. Concurrent channel conversations therefore cannot erase or mix shared
in-process or Redis-backed history.

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
- Bind signed claims to the parsed request fields used for routing.
- Keep public app route handlers separate from control-plane handlers.
- Add tests for invalid signatures, malformed payloads, and successful dispatch
  paths when changing channel behavior.

## Related guides

- [Agent service runtime](../guides/agent-service-runtime.md)

## Related reference

- [`veryfront/agent/conversation-control-plane`](../api-reference/veryfront/agent.md)
- [`veryfront/agent/service-runtime`](../api-reference/veryfront/agent.md)
