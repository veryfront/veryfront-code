# Workflow run control implementation plan

Date: 2026-07-24
Branch: `refactor/architecture-workflow-run-control`
Baseline: `0d97234c4dc65b61e082806deaedc024333a8777`

## Scope

Refactor Workflow run lifecycle control into the private Module `src/workflow/runtime/workflow-run-control.ts`.

Do not change public APIs, public exports, command behavior, backend Interfaces, user-facing output, or dependencies. Lock behavior with tests before moving implementation.

## Files in scope

- `src/workflow/runtime/workflow-run-control.ts`, new private Module.
- `src/workflow/runtime/workflow-run-control.test.ts`, new transition/race matrix tests.
- `src/workflow/executor/workflow-executor.ts`, adapter over `execute(...)`.
- `src/workflow/worker/run-manager.ts`, adapter over `claim(...)`.
- `src/workflow/runtime/approval-manager.ts`, adapter over `reconcile(...)`.
- `src/workflow/worker/shared.ts`, adapter for env hydration and execution failure reconciliation.
- `src/workflow/worker/run-entrypoint.ts`, only if helper call shapes change.
- Existing focused tests, only as needed to preserve public behavior.

## Files out of scope

- `deno.json` exports.
- Public type files unless type-only reuse is unavoidable.
- Backend Interface changes.
- `src/workflow/backends/memory.ts` and `src/workflow/backends/redis/index.ts`, unless tests expose a real parity gap that must be fixed in both backends.
- DAG, StepExecutor, Workflow DSL, Blob storage, React hooks, CLI command parsing, templates, and generated docs.
- Queue-worker internals in `src/workflow/worker/workflow-worker.ts`, except for keeping shared backend owner-fencing tests green.

## Baseline verification

Run focused tests before edits:

```bash
deno test --no-check --allow-all src/workflow/executor/workflow-executor.test.ts src/workflow/worker/run-manager.test.ts src/workflow/worker/run-entrypoint.test.ts src/workflow/worker/shared.test.ts src/workflow/runtime/approval-manager.test.ts src/workflow/backends/memory.test.ts src/workflow/backends/redis/index.test.ts
```

Expected result: the baseline is green. If it fails, record the failure and do not hide it with refactor changes.

## TDD sequence

### 1. Add RED Module tests

Create `src/workflow/runtime/workflow-run-control.test.ts` with `describe()` and `it()` from `#veryfront/testing/bdd.ts` and assertions from `#veryfront/testing/assert.ts`.

Start with tests that fail because the Module does not exist:

- `execute activates pending runs through an owner/status gate`.
- `execute does not complete after durable owner changes`.
- `execute leaves replacement owner state untouched after lock loss`.
- `execute releases the waiting lock before callback reconciliation`.
- `execute keeps cancellation terminal over completion and failure`.
- `claim marks pending runs running before isolated execution creation`.
- `claim skips pending runs when the pending lock cannot be acquired`.
- `claim skips pending runs that change status after the pending lock`.
- `claim fails an already-claimed spawn failure only under the claimed owner`.
- `claim recovers stalled runs through claimStalledRun`.
- `reconcile keeps cancellation terminal during approval rejection`.
- `reconcile persists approval decisions against the current owner and retries on owner change`.
- `reconcile does not hydrate env for stale entrypoint owners`.
- `reconcile does not fail execution for stale entrypoint owners`.

Use `MemoryBackend` and small fake adapters first. Reuse fixture patterns from the existing executor, run-manager, approval-manager, run-entrypoint, and shared-helper tests.

Run:

```bash
deno test --no-check --allow-all src/workflow/runtime/workflow-run-control.test.ts
```

Expected result: RED for missing symbols or missing behavior.

### 2. Add the minimal Module skeleton

Add `src/workflow/runtime/workflow-run-control.ts` with internal exported types only for adapter use:

- `WorkflowRunControlExecuteInput`
- `WorkflowRunControlExecuteOutcome`
- `WorkflowRunControlClaimInput`
- `WorkflowRunControlClaimOutcome`
- `WorkflowRunControlReconcileInput`
- `WorkflowRunControlReconcileOutcome`

Use existing types where possible: `WorkflowBackend`, `WorkflowRun`, `WorkflowStatus`, `WorkflowContext`, `NodeState`, `RunExecutionConfig`, and `RunExecutor`.

Run the new Module test after each small addition:

```bash
deno test --no-check --allow-all src/workflow/runtime/workflow-run-control.test.ts
```

Expected result: RED moves from missing symbols to specific missing behavior.

### 3. Move execution control

Move decision logic out of `WorkflowExecutor.executeRun(...)`, `completeRun(...)`, `failRun(...)`, and `pauseRun(...)` in small steps:

- Lock acquire, extend, release, and lock-loss decisions.
- Activation transition.
- Heartbeat owner verification.
- Completion, failure, waiting, cancellation, and stale-controller gates.
- Waiting lock release before callback.
- Public-context projection before persistence.

Keep these responsibilities in `WorkflowExecutor`:

- Workflow lookup and registration.
- Node resolution and validation.
- DAG execution.
- Timeout and cancellation-grace execution wrapper, unless the wrapper has to move with abort ownership.
- Workflow output schema parsing.
- Public callbacks.
- Handles, result polling, cancel, list, and get methods.

Run:

```bash
deno test --no-check --allow-all src/workflow/runtime/workflow-run-control.test.ts src/workflow/executor/workflow-executor.test.ts
```

Expected result: execute Module tests and public executor tests are green.

### 4. Move manager claim control

Move decision logic out of `WorkflowRunManager.poll()` and `createExecutionForWorkflow(...)`:

- Pending lock acquire and release.
- Pending run re-read after lock.
- Stalled claim through `claimStalledRun`.
- Durable owner assignment as `run-execution:${executionId}`.
- Source policy requirement before isolated execution creation.
- Running update before spawn.
- Failed-before-claim and failed-after-claim handling.
- Structured claim outcomes for stats and logging.

Keep these responsibilities in `WorkflowRunManager`:

- Timer lifecycle.
- Manager status and stats.
- Active execution map.
- `RunExecutor` initialize, list, delete, and destroy calls.
- Scheduling and concurrency slots.
- Status sync and missing-execution cleanup.

Run:

```bash
deno test --no-check --allow-all src/workflow/runtime/workflow-run-control.test.ts src/workflow/worker/run-manager.test.ts
```

Expected result: claim Module tests and public manager tests are green.

### 5. Move reconciliation control

Move shared owner/status reconciliation into `reconcile(...)`:

- Approval decision context and node-state patch.
- Bounded retry when ownership changes.
- Rejected approval failure transition.
- Terminal/cancelled no-op behavior.
- Owner-gated env hydration.
- Owner-gated isolated execution failure.

Keep these responsibilities outside the Module:

- Approval lookup.
- Expiry and approver validation.
- `updateApproval` call as the authoritative decision race gate.
- Notifier behavior.
- Expiration timer.
- Optional `WorkflowExecutor.resume(...)`.
- Env reads, tenant context restoration, final exit-code mapping, and logging shape.

Run:

```bash
deno test --no-check --allow-all src/workflow/runtime/workflow-run-control.test.ts src/workflow/runtime/approval-manager.test.ts src/workflow/worker/shared.test.ts src/workflow/worker/run-entrypoint.test.ts
```

Expected result: reconciliation Module tests and public adapter tests are green.

### 6. Keep backend parity green

Run backend contract tests unchanged:

```bash
deno test --no-check --allow-all src/workflow/backends/memory.test.ts src/workflow/backends/redis/index.test.ts
```

Expected result: Memory and Redis behavior stay green. If a backend change is necessary, add or update equivalent Memory and Redis tests first.

### 7. Delete only duplicate private wiring tests

After the Module and public adapter tests pass, remove only tests that assert the old private location of implementation details.

Keep these tests:

- Public executor behavior tests.
- Public manager behavior and stats tests.
- Public approval validation, notifier, expiration, and resume tests.
- Entrypoint fencing and exit-code tests.
- Backend atomic contract tests.
- Integration tests.

Run the focused suites again after any deletion.

## Final verification

Run the focused Workflow run-control gate:

```bash
deno test --no-check --allow-all src/workflow/runtime/workflow-run-control.test.ts src/workflow/executor/workflow-executor.test.ts src/workflow/worker/run-manager.test.ts src/workflow/worker/run-entrypoint.test.ts src/workflow/worker/shared.test.ts src/workflow/runtime/approval-manager.test.ts src/workflow/backends/memory.test.ts src/workflow/backends/redis/index.test.ts
```

Run the broader Workflow gate:

```bash
deno test --no-check --allow-all --parallel src/workflow
```

Run diff hygiene:

```bash
git diff --check
```

If the broader Workflow gate is slow or environment-sensitive, report the exact failure and keep the focused gate as the minimum evidence.

## Review checklist

- The Module is deep and hides conditional write order, heartbeat outcomes, waiting lock release, lock-loss behavior, and approval retry details.
- The Interface has three operations, not a collection of old private helpers.
- Public exports are unchanged.
- `WorkflowRun.workerId` remains the durable owner.
- Lock tokens remain lease tokens only.
- Owner-aware writes use `updateRunIfStatus(..., expectedWorkerId)` or backend append gates.
- Cancellation remains terminal over completion and failure.
- Approval decisions remain durable after `updateApproval` succeeds.
- Source policy and tenant context are still captured and restored.
- Memory and Redis backend parity tests remain in the verification gate.

## Handoff notes

Implement this candidate before lower-ranked architecture candidates. Keep the branch isolated and do not merge unrelated changes from the main tree or other worktrees.
