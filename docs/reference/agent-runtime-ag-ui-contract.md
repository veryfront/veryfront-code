# Agent runtime AG-UI contract

This document defines the canonical runtime-facing request contract for the `veryfront` package.

The goal is to make downstream consumers target one explicit AG-UI-aligned input model instead of treating the current runtime transport as a custom side protocol.

## Canonical contract

The canonical runtime contract is defined in [`src/agent/runtime-ag-ui-contract.ts`](../../src/agent/runtime-ag-ui-contract.ts) by [`AgUiRuntimeRequestSchema`](../../src/agent/runtime-ag-ui-contract.ts).

It is based on the AG-UI `RunAgentInput` shape:

- `threadId`
- `runId`
- `parentRunId`
- `state`
- `messages`
- `tools`
- `context`
- `forwardedProps`

The runtime response contract remains AG-UI SSE.

## Supported AG-UI subset

The package runtime currently accepts a text-first subset of AG-UI messages:

- `system`
- `user`
- `assistant`
- `tool`

Current message support is intentionally narrower than the full AG-UI type catalog:

- text content is supported for `system`, `user`, `assistant`, and `tool`
- assistant `toolCalls` are supported
- tool messages use `toolCallId` + text content

The package runtime does not currently treat `developer`, `activity`, or `reasoning` messages as canonical input roles for this contract.

## Package and runtime extensions

The canonical runtime contract keeps a small number of package/runtime extensions:

- message `metadata`
- message `createdAt`
- structured context entries beyond plain AG-UI `{ description, value }`

Structured runtime context currently supports:

- `{ type: "text", text, title? }`
- `{ type: "json", data, title? }`
- `{ type: "resource", uri, text?, mimeType?, title? }`

These extensions are part of the package runtime contract, not AG-UI core.

## Control-plane runtime invocation wrapper

`RuntimeAgentRunInvocationSchema` defines the service-to-service wrapper used
when a trusted control plane invokes a separately deployed runtime agent
service.

The wrapper carries control-plane-owned metadata that does not belong in the
public AG-UI runtime request body:

- runtime service and agent ids
- conversation, run, message, and input-anchor ids
- project and runtime-target context
- optional parent-run and spawn lineage
- optional validated claims
- runtime tools, context, source metadata, and forwarded props

The wrapper does not replace `AgUiRuntimeRequestSchema`. Hosts should use
`AgUiRuntimeRequestSchema` for public AG-UI runtime routes and use
`RuntimeAgentRunInvocationSchema` only for signed control-plane routes where
the control plane owns durable run identity and project context.

Private routes such as `/api/control-plane/agents/stream` can use this wrapper as their
host-specific service boundary, then normalize the message payload into the
local agent runtime input model before execution.

## Endpoint convention

The package should standardize the runtime contract, not force one hardcoded route.

Recommended default convention:

- `POST /api/ag-ui`
- `POST /api/runs`
- `POST /api/runs/:runId/resume`
- `DELETE /api/runs/:runId`

Hosts may override the route when needed.

Public control-plane wrapper convention:

- `POST /api/control-plane/agents/list`
- `POST /api/control-plane/agents/stream`
- `POST /api/control-plane/agents/runs/:runId/resume`
- `DELETE /api/control-plane/agents/runs/:runId`

Private signed control-plane wrappers:

- `POST /api/control-plane/agents/stream`
- `POST /api/control-plane/agents/runs/:runId/resume`
- `DELETE /api/control-plane/agents/runs/:runId`

When a host needs to interoperate with the signed control-plane wrapper shape
directly, the current request/response schemas and signature verification
helpers are available as public package exports:

- `veryfront/channels/control-plane`
- `veryfront/channels/invoke`

Those internal handlers are Veryfront-specific wrappers around the generic
package-hosted run-control surface. Downstream package consumers should target
the public `veryfront/agent` handlers unless they are implementing a trusted
control-plane runtime service.

## What downstream consumers should target

Downstream package/framework consumers should target:

- the canonical `AgUiRuntimeRequestSchema`
- the public `parseAgUiRuntimeRequest()` / `parseAgUiRuntimeRequestOrError()` helpers when they want framework-owned runtime-request parsing without using the higher-level `createAgUiHandler()` wrapper
- `createAgUiRuntimeHandler()` when they want package-owned runtime-request parsing plus either direct package streaming or a host-provided execution handoff
- `normalizeAgUiRuntimeMessages()` when they need the canonical runtime-message to package-message conversion outside the default handler path
- AG-UI SSE responses
- the default endpoint convention `/api/ag-ui` unless a host explicitly documents another route

Control-plane runtime service implementers can also target:

- `RuntimeAgentRunInvocationSchema`
- `parseRuntimeAgentRunInvocation()`
- `parseRuntimeAgentRunInvocationOrError()`

They should not treat `/api/control-plane/agents/stream` as the public package AG-UI
contract.
