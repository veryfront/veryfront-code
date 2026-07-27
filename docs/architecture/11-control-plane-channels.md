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

1. A trusted service signs a channel request with a canonical compact EdDSA JWS.
2. The project runtime bounds the envelope, verifies the Ed25519 signature,
   then parses and validates the protected header, claims, freshness, body
   hash, project audience, and request shape.
3. Channel dispatch additionally binds the signed subject, project, and
   platform claims to the corresponding request-body fields.
4. Dispatch handlers route the request to the intended control-plane operation.
5. Invoke handlers execute project-scoped runtime work and return structured
   results.

## Boundaries

- Control-plane channels are signed management surfaces, not public app routes.
- Compact JWS parts, verification keys, timestamps, and freshness policies are
  bounded and canonical. Unsupported critical protected-header parameters are
  rejected; non-critical metadata remains forward-compatible. Optional expected
  claims are checked whenever supplied, including explicitly empty values.
- Protected headers and claims are parsed after signature verification by the
  same dependency-free boundary code in proxy and runtime contexts. Verification
  does not depend on optional schema-extension registration or initialization
  order.
- The proxy accepts only the dispatch-token family on `/channels/invoke` and
  only the control-plane-token family on control-plane/internal routes. This
  proxy check establishes signature authenticity and freshness only; the
  renderer still performs body, audience, project, subject, and surface binding
  before consuming a request.
- Signed request bodies are byte-capped before verification. Signature
  verification precedes JSON/schema interpretation, so unauthenticated payloads
  cannot drive protocol parsing or discovery.
- Agent run sessions are keyed by the verified project claim and run ID.
  Stream, resume, and cancel handlers use the signed `project_id`; an unsigned
  header, request context, or caller-chosen run ID cannot select another
  project's session. Identical run IDs in different projects remain isolated.
- Conversation-history timestamps use ISO 8601 date-time strings. Orphan tool
  results and duplicate tool-call identities are discarded rather than assigned
  a fabricated or ambiguous tool name.
- Invocations sharing an agent with persistent memory are serialized across the
  memory reset and generation operation. Their queue is bounded, aborted queued
  work never executes, and request cancellation reaches generation. Stateless
  agents remain concurrent.
- Invoke results cross the HTTP boundary only as bounded, acyclic, data-only
  JSON. Tool inputs/results and response cardinality are checked before
  serialization; discovery and runtime failures remain structured retry
  decisions rather than escaping the invoke contract.
- `POST /api/ag-ui` is the public AG-UI transport adapter.
- `/api/runs*` is the sibling run-control API for hosted runtime lifecycle
  operations.
- Conversation-scoped run APIs in Veryfront API provide run lineage, read, and
  replay for conversation-attached runs.
- AG-UI event encoding belongs in [AG-UI transport](./06-ag-ui-transport.md).
- MCP JSON-RPC dispatch belongs in [MCP runtime](./10-mcp-runtime.md).

## Change checks

- Preserve signature validation before any dispatch.
- Keep proxy signature-family selection aligned with the downstream route.
- Keep public app route handlers separate from control-plane handlers.
- Preserve project-scoped session identity across stream, resume, and cancel
  operations, and propagate cancellation through setup and remote discovery.
- Add tests for invalid/non-canonical signatures, malformed payloads, queue and
  cancellation behavior, and successful dispatch paths when changing channel
  behavior.

## Related guides

- [Agent service runtime](../guides/agent-service-runtime.md)

## Related reference

- [`veryfront/agent/conversation-control-plane`](../api-reference/veryfront/agent.md)
- [`veryfront/agent/service-runtime`](../api-reference/veryfront/agent.md)
