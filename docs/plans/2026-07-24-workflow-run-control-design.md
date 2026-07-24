# Workflow run control design

Date: 2026-07-24
Branch: `refactor/architecture-workflow-run-control`
Baseline: `0d97234c4dc65b61e082806deaedc024333a8777`

## Target result

Create one private deep Module at `src/workflow/runtime/workflow-run-control.ts`.

The Module owns Workflow run lifecycle decisions that are currently spread across execution, isolated run claiming, approval reconciliation, and run-entrypoint failure helpers. Existing public classes and functions stay as adapters with unchanged signatures.

The intended private Interface is:

```ts
execute(...): Promise<WorkflowRunControlExecuteOutcome>;
claim(...): Promise<WorkflowRunControlClaimOutcome>;
reconcile(...): Promise<WorkflowRunControlReconcileOutcome>;
```

The Interface must be deep. Callers ask for run-control outcomes without needing to know conditional write order, lock release order, heartbeat failure handling, approval retry behavior, or owner fencing.

## Current evidence

The current implementation already has the primitives this Module must reuse:

- `src/workflow/executor/workflow-executor.ts` owns run activation, distributed lock acquire/extend/release, heartbeat, cancellation precedence, waiting handoff, completion, failure, and owner-fenced terminal writes.
- `src/workflow/worker/run-manager.ts` owns pending-run locking, pending re-read, stalled-run claim, isolated execution creation, spawn-failure handling, source policy restoration, and manager stats.
- `src/workflow/runtime/approval-manager.ts` owns approval validation, atomic decision persistence through `updateApproval`, owner retry during run reconciliation, rejection failure, expiration, notifier behavior, and optional resume.
- `src/workflow/worker/shared.ts` owns isolated execution identity, tenant/env helpers, owner-gated env hydration, final exit-code mapping, and owner-gated execution failure.
- `src/workflow/worker/run-entrypoint.ts` owns environment reads, source policy checks, tenant wrapper selection, `WorkflowExecutor.resume(...)`, and exit-code return.
- `src/workflow/backends/types.ts` defines the backend Interface and the `updateRunIfStatus(...)` helper that fails closed when owner-aware writes are requested but a backend lacks `updateRunIfStatusAndWorker`.
- `src/workflow/backends/memory.ts` and `src/workflow/backends/redis/index.ts` already implement owner/status writes, token-aware lock release and extension, stalled claims, checkpoint append gates, and approval append gates.

The existing focused test surface is:

- `src/workflow/executor/workflow-executor.test.ts`
- `src/workflow/worker/run-manager.test.ts`
- `src/workflow/worker/run-entrypoint.test.ts`
- `src/workflow/worker/shared.test.ts`
- `src/workflow/runtime/approval-manager.test.ts`
- `src/workflow/backends/memory.test.ts`
- `src/workflow/backends/redis/index.test.ts`

## Compatibility constraints

Preserve all public behavior and exports:

- Keep `WorkflowExecutor`, `WorkflowRunManager`, `runWorkflowRun`, `createWorkflowRunEntrypoint`, `ApprovalManager`, `WorkflowBackend`, `MemoryBackend`, and `RedisBackend` public signatures unchanged.
- Keep `deno.json` exports unchanged.
- Keep Workflow statuses unchanged: `pending`, `running`, `waiting`, `completed`, `failed`, and `cancelled`.
- Keep immutable run fields protected by `assertWorkflowRunUpdate`.
- Keep callback behavior and timing for `onStart`, `onComplete`, `onError`, and `onWaiting`.
- Keep current cancellation precedence over completion and failure.
- Keep direct in-process execution and isolated run-manager execution behavior.
- Keep source integration policy capture, restoration, and failure paths.
- Keep tenant context and environment injection semantics.
- Keep Memory and Redis backend parity.
- Do not add dependencies.

## Module responsibilities

### `execute(...)`

`execute(...)` owns durable execution control for one selected Workflow run:

- Verify the run still exists and, when provided, still belongs to the expected durable owner.
- Acquire the backend lock when locking is enabled and supported.
- Activate `pending`, `waiting`, or `running` runs through a status and optional owner gate.
- Maintain heartbeat updates while preserving owner checks.
- Extend locks with the lease token returned by `acquireLock`.
- Abort the DAG when lock renewal fails.
- Abort the DAG when owner heartbeat cannot verify durable ownership.
- Keep cancellation terminal over completion and failure.
- Complete, fail, or pause only through current status and owner gates.
- Release the lock before `onWaiting` so an immediate approval can resume the run.
- Strip execution-only tenant metadata before persisting public context and output.
- Avoid terminal writes after lock loss, owner loss, stale controller replacement, or cancellation.

`WorkflowExecutor` remains responsible for Workflow registration, node resolution, DAG execution, schema validation, callbacks, handles, polling, public cancellation, and result methods.

### `claim(...)`

`claim(...)` owns manager-side claim and isolated execution creation decisions:

- Process pending and stalled candidate runs.
- Acquire a short pending lock for pending runs when lock support exists.
- Re-read pending runs after the lock and skip if status changed.
- Claim stalled runs through `claimStalledRun`.
- Create a durable isolated owner as `run-execution:${executionId}`.
- Mark the run `running` before spawning the isolated execution.
- Restore source integration policy before execution creation.
- Fail before claim for missing source policy or pre-claim errors while the run remains active.
- Fail after claim only while status is `running` and `workerId` matches the isolated owner.
- Always release the pending lock.
- Return structured outcomes for the adapter to map to stats and logs.

`WorkflowRunManager` remains responsible for timers, polling cadence, active execution tracking, stats, concurrency slots, executor lifecycle, execution status sync, and logging.

### `reconcile(...)`

`reconcile(...)` owns shared owner/status reconciliation:

- Apply a durable approval decision to the current active owner.
- Retry approval reconciliation when ownership changes between read, conditional patch, and resume.
- Preserve `updateApproval` as the authoritative approval-decision race gate.
- Fail rejected approvals only while the run is active and still owned by the expected owner.
- Skip terminal and cancelled runs.
- Hydrate injected env only while status and owner still match.
- Fail isolated execution errors only while status and owner still match.

`ApprovalManager` remains responsible for approval lookup, expiry and approver validation, notifier behavior, expiration timers, public `approve` and `reject`, and optional executor resume.

`run-entrypoint.ts` and `shared.ts` remain responsible for environment reads, tenant context, source policy wrapper use, final exit-code mapping, and logging shape.

## Durable owner and lease token invariant

`WorkflowRun.workerId` is the durable execution owner. It is persisted in run state and must be checked with backend status/worker conditional operations.

The value returned from `acquireLock` is a lease token. It must be passed only to `extendLock` and `releaseLock`. It must not become `workerId`.

Preserve these outcomes:

- A lost lease token aborts the current DAG and leaves terminal status to the replacement owner.
- A lost durable owner aborts the current DAG without writing output, error, checkpoint, approval, or terminal status.
- A stale owner can release only its old lease token.

## Transition and race matrix

| Scenario                                     | Expected result                                                | Required gate                                   |
| -------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------- |
| Direct start creates run                     | Run is `pending` with optional `workerId`                      | `createRun` preserves tenant and source policy  |
| Direct execute activates                     | Active run becomes `running`                                   | Status gate plus optional owner gate            |
| Pending manager claim                        | `pending` becomes `running` with `workerId=run-execution:<id>` | Pending lock, re-read, status gate              |
| Pending lock is held                         | No isolated execution starts                                   | `acquireLock` returns `null`                    |
| Pending status changes after lock            | No isolated execution starts                                   | Re-read rejects non-`pending` status            |
| Spawn fails before claim                     | Active run becomes `failed` without owner gate                 | Status gate only                                |
| Spawn fails after claim                      | Claimed `running` run becomes `failed`                         | Status `running` plus claimed owner             |
| Stalled claim wins                           | Stalled `running` run gets replacement owner                   | Backend `claimStalledRun` atomic check          |
| Stalled claim loses                          | No isolated execution starts                                   | `claimStalledRun` returns `false`               |
| Old owner completes after replacement        | No terminal write                                              | Owner/status gate fails                         |
| Successful execution                         | `running` becomes `completed`                                  | Status `running` plus owner gate                |
| Failed execution                             | `running` becomes `failed`                                     | Status `running` plus owner gate                |
| Waiting handoff                              | `running` becomes `waiting`                                    | Status `running` plus owner gate                |
| Immediate approval during `onWaiting`        | Resume can acquire execution control                           | Lock released before callback                   |
| Waiting callback rejects before replacement  | `waiting` becomes `failed`                                     | Status `waiting` plus owner gate                |
| Waiting callback rejects after replacement   | Replacement owner remains untouched                            | Owner gate fails                                |
| Approval decision race loses                 | Run is not mutated                                             | `updateApproval` returns `false`                |
| Approval owner changes during reconciliation | Re-read and retry current owner                                | Bounded retry loop                              |
| Approval rejection                           | Active run becomes `failed`                                    | Active status plus owner gate                   |
| Cancellation during execution                | Run remains `cancelled`                                        | Re-read and status gate before terminal write   |
| Completion reads stale non-cancelled run     | Run remains `cancelled`                                        | Cancellation update wait plus conditional write |
| Lock extension fails                         | DAG aborts and no terminal write occurs                        | Lease-token extension check                     |
| Owner heartbeat fails                        | DAG aborts and no terminal write occurs                        | Status/owner heartbeat gate                     |
| Checkpoint append                            | Append only for current owner                                  | `saveCheckpointIfStatusAndWorker`               |
| Pending approval append                      | Append only for current waiting owner                          | `savePendingApprovalIfStatusAndWorker`          |
| Env hydration in stale entrypoint            | Stale owner does not write env                                 | Status/owner gate                               |
| Entrypoint failure in stale owner            | Replacement owner remains untouched                            | Status/owner gate                               |

## Boundaries

Inside the new Module:

- Run activation and terminal transition decisions.
- Lock acquisition, renewal, release ordering, and lock-loss outcomes.
- Heartbeat owner verification decisions.
- Waiting handoff and callback safety decisions.
- Manager claim, spawn, and failure decision outcomes.
- Approval decision reconciliation.
- Owner-gated env hydration and isolated failure reconciliation.

Outside the new Module:

- Workflow definition registration and lookup.
- DAG node resolution and execution.
- Step execution.
- Approval notification, authorization, lookup, and timers.
- `RunExecutor` implementation and lifecycle.
- Backend storage mechanics.
- Public CLI command parsing and help.
- Public TypeScript exports.
- Queue-worker behavior in `WorkflowWorker`, except where backend owner-fencing contracts remain shared.

## Adapter plan

- `WorkflowExecutor` delegates run-control decisions to `execute(...)` while preserving its public methods and DAG orchestration.
- `WorkflowRunManager` delegates claim/spawn/failure policy to `claim(...)` while preserving polling, status sync, stats, and executor lifecycle.
- `ApprovalManager` delegates owner/status reconciliation to `reconcile(...)` while preserving public approval validation, notifier behavior, expiration, and resume calls.
- `shared.ts` delegates env hydration and execution-failure gates to `reconcile(...)` while preserving env reads, tenant wrapper helpers, exit-code helpers, and logger shape.
- `run-entrypoint.ts` changes only if helper call shapes require it.
- `CheckpointManager` keeps using backend owner-aware append primitives. Do not move checkpoint storage.

## Acceptance criteria

- `src/workflow/runtime/workflow-run-control.ts` exists and is private.
- Existing public Workflow, worker, runtime, backend, and CLI APIs remain unchanged.
- Existing adapters are thinner around the new Module but still own public orchestration.
- Durable owner and lease token remain separate.
- Cancellation remains terminal over completion and failure.
- Waiting lock release still occurs before approval notification callbacks.
- Approval decisions remain durable even when resume/reconcile races occur.
- Memory and Redis backend parity remains covered.
- No dependency is added.
- No unrelated refactor is included.

## Risks

- This area is race-sensitive. A broad rewrite can break callback ordering, cancellation precedence, or owner fencing.
- Moving DAG execution, notification, process execution, or backend storage into the Module would make the Interface shallow and harder to verify.
- Normalizing error text can break tests or public behavior.
- Redis parity can diverge if the Module assumes Memory backend behavior.
- Approval decision durability is subtle: once `updateApproval` succeeds, reconciliation must either complete, retry, or fail explicitly.

## Rollback plan

The work is isolated on `refactor/architecture-workflow-run-control`. Roll back by dropping the worktree/branch or reverting the implementation commit. Because the design keeps public adapters intact, a partial rollback can restore old adapter internals without changing public exports.
