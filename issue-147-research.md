# Issue 147 research: preserve parent MCP authorization in delegated runs

## Staging evidence

- Framework version: `0.1.1112`
- Parent run: `8c4153ed-451d-49ab-ba19-338e8ec3f174`
- Conversation: `c5ed9f76-aa52-4b6c-9cce-b0144db9b60f`
- The scoped `agent_ingestion-agent` delegate resolved and executed.
- Its first Outlook calls failed with `Run context does not match the authenticated token`.
- The child returned a completed response with three tool calls and no mailbox data.

## Repository findings

1. Hosted requests create remote MCP sources with a request-scoped authorization token.
2. `traceConfiguredToolExecution` exposes those sources to nested local execution through
   async-local storage.
3. Delegated runtimes correctly inherit the source and apply their own narrower tool
   policy.
4. The inherited source currently receives the delegated runtime's `runId` and
   `agentId` when it executes a remote tool.
5. `remote-mcp.ts` sends those values as MCP `_meta`, but the authorization header still
   contains the parent request-scoped token.
6. The API rejects that token/metadata combination. Tool discovery succeeds because
   `tools/list` has no run metadata; `tools/call` fails.

## Chosen direction

Bind inherited remote sources to the execution identity that introduced them into the
nested runtime boundary:

- preserve the nested call's project, tool-call, cancellation, and telemetry context;
- override only `authToken`, `runId`, and `agentId` when the parent has those fields;
- retain existing remote-tool policy wrappers so children can only narrow authority;
- keep child durable-run identity unchanged for lifecycle events and telemetry.

Binding belongs at the async-local inheritance boundary, not in the generic MCP client.
Suppressing MCP metadata globally would weaken the server-side run authorization
contract. Minting a separate child-scoped token would require a broader API/runtime
contract change and is unnecessary for a local delegate acting under the parent's
already-declared authority.

This makes the audit model explicit: remote integration authorization is attributed to
the run that owns the credential and declared the inherited capability. The delegated
runtime still retains its own durable child-run lifecycle and tool-call telemetry. If
delegates later need independent remote authorization principals, that should be a
separate child-token issuance design rather than an implicit change to this inheritance
boundary.

## Risks and mitigations

- **Nested delegates could accidentally rebind to an intermediate child.** Wrappers must
  compose so the innermost/original parent binding remains authoritative.
- **A parent without a field could erase a valid child field.** Bind only fields that are
  explicitly defined.
- **Tool ceilings could widen.** Keep binding separate from and inside the existing
  policy-constrained source chain; add regression coverage for both identity and the
  existing allowlist.
