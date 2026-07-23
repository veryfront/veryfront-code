# Issue 147 PRD: delegated MCP calls use the credential-bound parent identity

## Problem

A local delegated agent can inherit a request-scoped Veryfront MCP source and discover
its allowed tools, but tool execution attaches the child run and agent IDs to a parent
run-scoped token. The API rejects every call with `Run context does not match the
authenticated token`.

## Solution

Add a small remote-source wrapper that binds credential-related execution fields to the
parent tool execution context. Apply it when `traceConfiguredToolExecution` publishes
remote sources to nested local runtimes.

The wrapper must:

- bind defined parent `authToken`, `runId`, and `agentId` values;
- preserve all other nested execution fields;
- compose safely across child and grandchild execution;
- leave existing tool-policy constraints unchanged.

## Implementation

1. Add a failing delegated-runtime regression test that makes the child execute an
   inherited remote tool and captures the source execution context.
2. Add the execution-identity binding wrapper near the runtime MCP source helpers.
3. Bind constrained inherited sources before placing them in async-local storage.
4. Bump the framework patch version.

## Verification

- New delegated-runtime regression test passes.
- Existing MCP source policy tests pass.
- Agent runtime test suite passes.
- `deno task build` passes.
- Staging rollout exposes the new framework version.
- A fresh `/orchestrate-job-submission` run can execute the ingestion agent's Outlook
  tools without a token/run-context mismatch.
