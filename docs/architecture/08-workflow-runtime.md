# Workflow runtime

This page describes workflow definition and execution. It does not cover agent
streaming, background task definitions, or run queue internals.

## Responsibility

The workflow runtime defines DAG steps, validates dependencies, executes steps,
tracks approvals, and persists workflow run state through configured backends.

Primary source areas:

- [`src/workflow/dsl/`](../../src/workflow/dsl/)
- [`src/workflow/executor/`](../../src/workflow/executor/)
- [`src/workflow/runtime/`](../../src/workflow/runtime/)
- [`src/workflow/backends/`](../../src/workflow/backends/)
- [`src/workflow/worker/`](../../src/workflow/worker/)
- [`src/workflow/api/`](../../src/workflow/api/)

## Runtime flow

```mermaid
flowchart TD
  definition[Workflow definition] --> graph[Build step graph]
  graph --> validate[Validate dependencies and graph shape]
  validate --> ready{Ready steps}
  ready --> agentStep[Agent step]
  ready --> toolStep[Tool step]
  ready --> waitStep[Wait or approval step]
  ready --> parallel[Parallel, map, or loop group]

  agentStep --> checkpoint[Checkpoint and backend state]
  toolStep --> checkpoint
  waitStep --> checkpoint
  parallel --> ready
  checkpoint --> complete{More ready steps?}
  complete -->|yes| ready
  complete -->|no| result[Workflow result]

  worker[Worker profile] --> ready
```

1. Workflow DSL helpers build step graphs, branches, loops, maps, parallel
   groups, waits, and sub-workflows.
2. Validation checks graph shape and step dependencies before execution.
3. The DAG executor evaluates ready steps and delegates individual step work to
   step executors.
4. Checkpoint and backend code stores run progress, approvals, and recovery
   state.
5. Worker entrypoints run adapter-backed workflow runs in process, subprocess, or
   Kubernetes execution profiles.

The executor enables locking unless the caller explicitly sets
`enableLocking: false`. A lock-capable backend supplies token-fenced acquire,
renew, release, and atomic run transitions as one complete capability; partial
support is rejected. Terminal and waiting transitions verify and consume the
exact lease token in the same backend transaction, so an expired owner cannot
publish stale state after a replacement acquires the lease.
`heartbeatInterval` must be no greater than one third of `lockDuration`, leaving
room for two missed renewal windows before lease expiry. A lost, malformed, or
unverifiable lease aborts execution instead of continuing unlocked.

Lease locking and durable compare-and-set protect framework state, but cannot
make arbitrary external tool effects exactly once across process pauses or
network partitions. Workflow execution is therefore at least once at the
side-effect boundary: tools that mutate external systems need idempotency keys
or provider-side fencing.

### Client readiness and backend ownership

`WorkflowClient` treats persistence readiness as part of admitting durable
work. Its first persistence operation lazily starts backend initialization, and
concurrent operations join that attempt instead of racing independent
connections. A failed attempt remains the client's readiness result and is
replayed to later operations. Recovery is an explicit decision:
`client.initialize()` starts a new attempt, and calling it after success
revalidates the backend. This fail-closed boundary prevents work from silently
moving to a fallback store or running against partially initialized
persistence. Synchronous registration and collaborator access do not cross the
readiness boundary.

The client always owns its executor and approval manager. Backend ownership is
separate. The default `"owned"` mode transfers the lifetime of either an
implicit or injected backend to the client. `"borrowed"` mode requires an
explicit backend and leaves that backend open for its composition root or
activated extension to close after all borrowers stop. Client destruction
closes admission and quiesces admitted work before disposing client-local
resources and, in owned mode, persistence. Concurrent destruction shares the
same attempt, while a failed cleanup remains retryable.

### Approval decision durability

Approval decisions cross two durable records: the approval row records who
decided and when, while the workflow run records the decision node and the
resulting resume or failure state. These writes cannot be one portable
transaction across every backend and execution adapter. The approval row is
therefore committed first with an atomic predicate over `waiting` run status,
pending approval status, and persisted expiry. One host-captured decision time
is used for both the expiry comparison and `decidedAt`, so backend latency does
not move the deadline.

Run reconciliation is idempotent. If a run read, run patch, or resume attempt
fails after the approval commit, an identical decision retry recognizes the
durable row, preserves its original `decidedAt`, and retries reconciliation. A
different retry is a conflict and is rejected. Expiry maintenance also scans
already-decided expired rows, so it can repair a system-expiry decision whose
run failure transition was interrupted.

A process crash after a user decision commit still requires the caller or an
operator to retry that exact decision; the runtime does not continuously scan
all non-expiry decisions. Resume is at least once across an ambiguous transport
failure, so custom executors must make resume idempotent. Historical approval
rows remain available by exact lookup for this recovery and for audit, but
pending listings and run snapshots expose them only while the run is still
`waiting`.

### Manager-to-entrypoint lease handoff

An isolated execution needs its own lease token. Sharing the manager's token
would make two processes indistinguishable to the backend, so either process
could renew or release ownership after the other had taken responsibility.

The manager retains and renews its claim lease while the executor registers the
isolated execution. This keeps the run fenced during a slow spawn. Registration
finishes when the execution becomes addressable through the executor's status,
list, and delete operations. It does not wait for child readiness: the child
cannot acquire its token until the manager verifies the durable worker identity
and releases the claim lease.

The isolated entrypoint then acquires a fresh token with the bounded duration,
timeout, and retry interval supplied by the manager. It maintains that token
while it hydrates environment state, discovers project modules, and executes the
workflow. A timed-out acquisition, ownership change, or failed token check ends
the stale execution before it can publish workflow state. This ordered handoff
avoids both concurrent ownership and an unfenced readiness window.

### Managed entrypoint ownership

A factory-created `WorkflowRunEntrypoint` represents one ephemeral workflow
execution rather than a reusable worker. The factory awaits backend readiness
and transfers ownership of the backend and per-run runtime to the handle. The
first invocation consumes the handle, and concurrent or later invocations fail
closed. Coupling invocation to automatic cleanup prevents a successful run from
leaving a connection, approval poller, or executor behind.

`destroy()` covers the path that invocation cannot: abandoning an initialized
handle before it starts. If execution is already active, destruction joins it
before cleanup rather than tearing resources out from under the run. Cleanup is
idempotent after success and retryable after failure. If execution and cleanup
both fail, the entrypoint reports an `AggregateError` so the primary failure is
not hidden by teardown.

The lower-level run functions express the opposite ownership boundary.
`runWorkflowRun()` borrows a caller-initialized backend and executor.
`runDynamicWorkflowRun()` borrows a caller-initialized backend while owning and
disposing only the executor and approval manager it creates for that run. These
functions therefore never infer ownership of shared persistence.

## Platform execution model

When the platform starts a workflow, it creates a canonical workflow run and
dispatches it through a runtime adapter:

- The public run has `kind = "workflow"`.
- The runtime target is `workflow:<workflow-id>`.
- The run service owns queueing, dispatch, retry, cancellation, logs, and worker
  lifecycle.
- The workflow runtime owns step graph execution, checkpoint state, approvals,
  and workflow result state.

This keeps workflow state distinct from runtime adapter mechanics while using
the run infrastructure for durable execution.

Public APIs should describe workflow execution as a workflow run. Lower-level
worker types may still use `WorkflowRunManager` and executor names because they
manage the runtime adapter that backs a workflow run.

## Boundaries

- A workflow is a step graph. It is not a run, task, schedule, or agent run.
- A workflow run may be backed by a runtime adapter. The workflow run remains the canonical
  public execution record for workflow APIs.
- Workflow API clients expose workflow run operations. They do not own step
  execution semantics.
- Agent steps may call the agent runtime, but workflow state remains owned by the
  workflow runtime.
- Completion and failure callbacks are post-persistence observers. Callback
  errors are logged without changing or disguising the durable terminal state.
- `WorkflowClient.destroy()` always stops approval maintenance and cancels and
  quiesces active client work. It destroys persistence only in `"owned"` mode;
  a `"borrowed"` backend remains the external owner's responsibility. New
  operations fail once closing starts.
- A factory-created workflow entrypoint owns its backend and per-run runtime and
  is one-shot. Low-level workflow run functions borrow caller-supplied runtime
  resources.
- An omitted approval allowlist delegates identity authorization to the trusted
  host boundary. A present allowlist is non-empty and canonical; every submitted
  approver identity is also canonical and non-empty.

## Change checks

- Add tests for graph validation when changing the DSL.
- Add executor tests when changing DAG ordering, approvals, retry behavior, or
  checkpointing.
- Keep workflow terminology aligned with `docs/guides/workflows.md`.

## Related guides

- [Workflows](../guides/workflows.md)

## Related reference

- [`veryfront/workflow`](../api-reference/veryfront/workflow.md)
