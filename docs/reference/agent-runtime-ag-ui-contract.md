# Agent Runtime AG-UI Contract

This document defines the canonical runtime-facing request contract for the `veryfront` package.

The goal is to make downstream consumers target one explicit AG-UI-aligned input model instead of treating the current runtime transport as a custom side protocol.

## Canonical Contract

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

## Supported AG-UI Subset

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

## Package/Runtime Extensions

The canonical runtime contract keeps a small number of package/runtime extensions:

- message `metadata`
- message `createdAt`
- structured context entries beyond plain AG-UI `{ description, value }`

Structured runtime context currently supports:

- `{ type: "text", text, title? }`
- `{ type: "json", data, title? }`
- `{ type: "resource", uri, text?, mimeType?, title? }`

These extensions are part of the package runtime contract, not AG-UI core.

## Transitional Transport Wrapper

The current internal transport route, `/internal/agents/stream`, is a compatibility wrapper, not the canonical package contract.

That wrapper currently adds transport-only fields:

- `agentId`
- `agentSource`

It also accepts the legacy message shape based on `parts`.

The wrapper is defined by [`InternalAgentStreamRequestSchema`](../../src/internal-agents/schema.ts) and normalized into the canonical runtime input with [`toRuntimeRunAgentInput()`](../../src/internal-agents/schema.ts).

## Endpoint Convention

The package should standardize the runtime contract, not force one hardcoded route.

Recommended default convention:

- `POST /api/ag-ui`
- `POST /api/ag-ui/runs`
- `POST /api/ag-ui/runs/:runId/resume`
- `DELETE /api/ag-ui/runs/:runId`

Hosts may override the route when needed.

Public control-plane wrapper convention:

- `POST /api/control-plane/agents/list`
- `POST /api/control-plane/agents/stream`
- `POST /api/control-plane/agents/runs/:runId/resume`
- `DELETE /api/control-plane/agents/runs/:runId`

Legacy internal compatibility route:

- `POST /internal/agents/stream`

Legacy internal signed control-plane wrappers:

- `POST /internal/agents/runs/:runId/resume`
- `DELETE /internal/agents/runs/:runId`

When a host needs to interoperate with the signed control-plane wrapper shape
directly, the current request/response schemas and signature verification
helpers are available as public package exports:

- `veryfront/channels/control-plane`
- `veryfront/channels/invoke`

Those internal handlers are Veryfront-specific wrappers around the generic
package-hosted run-control surface. Downstream package consumers should target
the public `veryfront/agent` handlers instead of these internal routes.

## What Downstream Consumers Should Target

Downstream package/framework consumers should target:

- the canonical `AgUiRuntimeRequestSchema`
- the public `parseAgUiRuntimeRequest()` / `parseAgUiRuntimeRequestOrError()` helpers when they want framework-owned runtime-request parsing without using the higher-level `createAgUiHandler()` wrapper
- `createAgUiRuntimeHandler()` when they want package-owned runtime-request parsing plus either direct package streaming or a host-provided execution handoff
- `normalizeAgUiRuntimeMessages()` when they need the canonical runtime-message to package-message conversion outside the default handler path
- AG-UI SSE responses
- the default endpoint convention `/api/ag-ui` unless a host explicitly documents another route

They should not treat `/internal/agents/stream` and its extra wrapper fields as the long-term package contract when the public `/api/control-plane/agents/*` route family is available.
