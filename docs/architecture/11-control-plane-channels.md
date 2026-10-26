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

Each `agents/list` entry carries `id`, `name`, `description`, `avatar_url`,
`model`, `version`, `skills` and `suggestions`. A successful schema conversion
also includes the authoritative complete `schema_snapshot` pair:
`{ version: 1, state: "captured", input: Identity | null, output: Identity | null }`.
Each identity contains `schema` (a boolean or JSON Schema object) and `sha256`
(the digest of its canonical JSON). The pair comes from the same resolved agent
definition. Agent input has no declared schema, so its captured input is `null`.
An agent without an output declaration still emits a captured pair with both
sides `null`: this means confirmed absence, rather than unknown schema state.
If conversion fails, the complete marker is omitted; absence of the marker
means unknown and must not qualify an authoritative schema pair.

For compatibility, convertible object output declarations also carry
`output_schema`. Boolean declarations appear only in `schema_snapshot`.
The legacy field is absent for undeclared or unconvertible output schemas;
its absence alone does not establish a captured null declaration. Consumers
should use the complete marker for authoritative admission instead of inferring
schema state from the legacy field.

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

Agent run signatures bind `agentSource` together with the runtime target kind,
environment ID, and branch ID. Shared runtimes revalidate a named source's
environment name/ID pair against project metadata before loading secrets.
The operator proxy verifies the body hash before reconstructing preview branch
ID/name pairs or a project's default branch name for the runtime; inbound
branch headers are discarded. The runtime compares the signed source with that
trusted context, so default branches are not assumed to be named `main`.
Branch and bare-release sources have no authoritative environment identity and
therefore receive no project environment variables.

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

- [`veryfront/agent/conversation-control-plane`](../api-reference/veryfront/agent.md)
- [`veryfront/agent/service-runtime`](../api-reference/veryfront/agent.md)
