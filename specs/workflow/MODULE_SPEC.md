# NLSpec: src/workflow/

## Purpose

A DAG-based workflow execution engine with human-in-the-loop support. Provides a TypeScript DSL for defining durable workflows composed of steps (agent or tool invocations), parallel execution, conditional branching, loops, map operations, sub-workflows, and wait/approval gates. Includes pluggable persistence backends (Memory, Redis, with Cloudflare/Inngest/Temporal stubs), checkpoint-based crash recovery, distributed locking, blob storage for large data, a polling worker for stalled-run recovery, a job manager for isolated execution (K8s or child processes), workflow discovery from user code, a high-level client API, React hooks for UI integration, and a Claude Code agentic integration sub-module.

## Public API

### Exports (from `index.ts`)

| Export | Type | Description |
|--------|------|-------------|
| `WorkflowContext` | type | Accumulates node outputs during execution; has `input` and indexed node results |
| `WorkflowDefinition` | type | Full workflow spec: id, steps, schemas, callbacks |
| `WorkflowNode` | type | Single node in the DAG: id + config + optional dependsOn |
| `WorkflowNodeConfig` | type | Union of all node config types (step, parallel, branch, wait, map, subWorkflow, loop) |
| `WorkflowRun` | type | Persisted run state: status, nodeStates, context, checkpoints, approvals |
| `WorkflowStatus` | type | `"pending" \| "running" \| "waiting" \| "completed" \| "failed" \| "cancelled"` |
| `CapturedTenantContext` | type | Multi-tenant context: projectSlug, token, projectId, productionMode, releaseId |
| `generateId` | function | Generates `{prefix}_{uuid12}` IDs |
| `parseDuration` | function | Parses `"10s"`, `"5m"`, `"2h"`, `"1d"` to milliseconds |
| `workflow` | function | DSL: creates and auto-registers a workflow definition |
| `step` | function | DSL: creates a step node (agent or tool) |
| `agentStep` | function | DSL: shorthand for step with agent |
| `toolStep` | function | DSL: shorthand for step with tool |
| `parallel` | function | DSL: concurrent execution of child nodes |
| `branch` | function | DSL: conditional if/then/else branching |
| `when` / `unless` | function | DSL: shorthand conditional branches |
| `waitForApproval` | function | DSL: human-in-the-loop approval gate |
| `waitForEvent` | function | DSL: pause until external event |
| `delay` | function | DSL: simple sleep/timer node |
| `loop` / `doWhile` / `times` | function | DSL: iteration primitives with max-iteration safety |
| `map` | function | DSL: fan-out over array items |
| `subWorkflow` | function | DSL: nested workflow execution |
| `dag` / `sequence` / `dependsOn` | function | DSL: explicit dependency graph construction |
| `BackendConfig` | type | Base backend configuration |
| `WorkflowBackend` | type | Persistence interface (runs, checkpoints, approvals, queue, locks) |
| `hasWorkerSupport` | function | Type guard: backend supports distributed worker features |
| `MemoryBackend` | class | In-memory backend for dev/testing |
| `RedisBackend` | class | Production Redis backend with streams, locks, stalled-run detection |
| `WorkflowClient` / `createWorkflowClient` | class/function | High-level facade: register, start, resume, cancel, approve/reject |
| `WorkflowExecutor` | class | Core orchestrator: manages DAG execution, timeouts, locking, lifecycle |
| `getWorkflowTenant` | function | AsyncLocalStorage accessor for current tenant context |
| `api` | object | Context-aware API: `api.files.read()`, `api.project.slug()` auto-resolve tenant |
| `useWorkflow` | React hook | Poll workflow run status, progress, cancel/retry |
| `useApproval` | React hook | Fetch and submit approval decisions |
| `useWorkflowList` | React hook | List/filter workflow runs with pagination |
| `useWorkflowStart` | React hook | Start a workflow and track the run ID |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `zod` | `zod` | Schema validation for inputs/outputs and inferred types |
| `Agent`, `AgentResponse` | `#veryfront/agent` | Agent execution in step nodes |
| `Tool` | `#veryfront/tool` | Tool execution in step nodes |
| `zodToJsonSchema` | `#veryfront/tool/schema` | Convert Zod schemas to JSON Schema for introspection |
| `ensureError` | `#veryfront/errors` | Normalize unknown caught values to Error instances |
| `logger`, `agentLogger` | `#veryfront/utils` | Structured logging |
| `AsyncLocalStorage` | `node:async_hooks` | Tenant context propagation without explicit threading |
| `getCurrentRequestContext`, `runWithRequestContext` | `#veryfront/platform` | Request-scoped tenant context for API routes |
| `VeryfrontApiClient` | `#veryfront/platform` | Tenant-scoped API calls (files, projects) |
| `ProjectScopedRegistryManager`, `ScopedRegistryFacade` | `#veryfront/ai` | Multi-tenant workflow metadata registry |
| `react` | `react` | React hooks (useState, useCallback, useEffect, useRef) |
| `@std/path` | Deno std | Path manipulation for discovery |
| `@aws-sdk/client-s3` | npm (dynamic) | S3 blob storage (lazy-loaded) |
| Redis adapters | `#veryfront/platform/adapters/redis` | Redis client abstraction (Deno/Node) |

## Behaviors

### Behavior 1: Workflow Definition and Registration

- **Given**: A developer calls `workflow({ id, steps, ... })`
- **When**: The function is invoked
- **Then**: A `Workflow` object is created wrapping a `WorkflowDefinition`, and it is auto-registered in the global `workflowRegistry` for dev-tools discovery
- **Edge cases**: Throws if `id` is empty; throws if `steps` is missing

### Behavior 2: Sequential Step Execution

- **Given**: A workflow with steps `[A, B, C]` where none have explicit `dependsOn`
- **When**: The workflow is executed
- **Then**: The DAG executor infers implicit sequential ordering: A runs first, then B, then C. Each step's output is stored in the workflow context under its node ID.
- **Edge cases**: If A fails, B and C do not execute; the run transitions to `"failed"`

### Behavior 3: Parallel Execution

- **Given**: A `parallel("p", [step("a", ...), step("b", ...)])` node
- **When**: Executed
- **Then**: Both child steps run concurrently (up to `maxConcurrency`). Child IDs are prefixed with `"p/"`. The parallel node completes when all children complete (strategy: `"all"`).
- **Edge cases**: Empty nodes array throws at definition time

### Behavior 4: Branch Execution

- **Given**: A `branch("b", { condition: fn, then: [...], else: [...] })` node
- **When**: The condition function evaluates
- **Then**: If truthy, the `then` nodes execute; otherwise `else` nodes execute. Child IDs are prefixed with `"b/then/"` or `"b/else/"`.
- **Edge cases**: If the selected branch is empty, the branch node completes with `{ skipped: true }`

### Behavior 5: Wait/Approval Gate

- **Given**: A `waitForApproval("review", { message, timeout })` node
- **When**: Execution reaches this node
- **Then**: The run transitions to `"waiting"` status. A `PendingApproval` is persisted. The `ApprovalManager` notifies via callback. Execution pauses until `approve()` or `reject()` is called.
- **Edge cases**: Approval expires after timeout; rejected approvals fail the run; only authorized approvers can decide

### Behavior 6: Loop Execution

- **Given**: A `loop("l", { while: fn, steps: [...], maxIterations: 10 })` node
- **When**: Executed
- **Then**: Steps execute repeatedly while the condition is true, up to `maxIterations`. Each iteration's context merges into the parent. Loop state is tracked for resume after waiting.
- **Edge cases**: `maxIterations` capped at 100; `doWhile` always runs first iteration; `times(n)` runs exactly n iterations

### Behavior 7: Checkpoint and Resume

- **Given**: A node with `checkpoint: true` completes
- **When**: The `CheckpointManager` creates a checkpoint
- **Then**: The full context and all node states are deep-cloned and persisted. On resume, execution restarts from the next node after the checkpoint.
- **Edge cases**: Steps with agents auto-checkpoint; wait nodes always checkpoint

### Behavior 8: Distributed Locking

- **Given**: A backend with lock support and `enableLocking !== false`
- **When**: `executeAsync()` is called
- **Then**: A lock is acquired for the run ID before execution. A heartbeat interval extends the lock every 10s. Lock is released in `finally` block.
- **Edge cases**: If lock acquisition fails, an error is thrown. If heartbeat extension fails, a warning is logged.

### Behavior 9: Stalled Run Recovery (Worker)

- **Given**: A `WorkflowWorker` with a backend supporting worker features
- **When**: The worker polls and finds runs with no heartbeat within `stalledThreshold`
- **Then**: The worker attempts to claim the run via atomic compare-and-swap, then resumes execution
- **Edge cases**: Multiple workers can race; only the winner of `claimStalledRun` proceeds

### Behavior 10: Job-Based Isolated Execution

- **Given**: A `WorkflowJobManager` with a `K8sJobExecutor` or `ProcessJobExecutor`
- **When**: A pending or stalled run is found during polling
- **Then**: A new K8s Job or child process is spawned with environment variables for run ID and tenant context. The job entrypoint fetches the run from Redis and executes it.
- **Edge cases**: Job timeout kills the process/pod; job creation failure marks the run as failed

### Behavior 11: Multi-Tenant Context Propagation

- **Given**: A workflow started from an API request with tenant context
- **When**: Steps execute
- **Then**: The tenant context is captured on the run, stored in Redis, propagated via `AsyncLocalStorage`, and accessible via `getWorkflowTenant()` and `api.*` helpers
- **Edge cases**: Jobs restore tenant from environment variables; no tenant context available outside request/workflow scope throws

### Behavior 12: Step Retry with Backoff

- **Given**: A step with `retry: { maxAttempts: 3, backoff: "exponential" }`
- **When**: The step fails with a retryable error (timeout, 429, 503, etc.)
- **Then**: The step retries with exponential backoff plus 10% jitter, up to `maxDelay`
- **Edge cases**: Non-retryable errors fail immediately; custom `retryIf` function overrides default patterns

### Behavior 13: Blob Storage Integration

- **Given**: A workflow executor configured with `blobStorage`
- **When**: A tool returns a `BlobRef` (object with `__kind: "blob"`)
- **Then**: The `BlobResolver` can retrieve content via `getText()`, `getBytes()`, `getStream()`. Supported backends: LocalBlobStorage (filesystem), S3BlobStorage, GCSBlobStorage.

### Behavior 14: Workflow Discovery

- **Given**: A project with `app/workflows/*.ts` files exporting workflow definitions
- **When**: `discoverWorkflows()` is called
- **Then**: Files are scanned, modules loaded, and exports checked for workflow definitions (direct or wrapped). Returns `DiscoveredWorkflow[]` with id, filePath, exportName, definition.

### Behavior 15: DAG Cycle Detection

- **Given**: Nodes with circular `dependsOn` references
- **When**: The DAG executor builds the graph
- **Then**: A DFS-based cycle detection returns an error result before any execution begins

## Constraints

- Node IDs must be non-empty strings; duplicate IDs within a workflow throw at validation time
- Loop `maxIterations` must be 1-100
- Steps must specify exactly one of `agent` or `tool` (not both, not neither)
- Parallel nodes must have at least one child
- Branch nodes must have at least one `then` node
- Duration strings must match `/^\d+(\.\d+)?\s*(ms|s|m|h|d)$/` and be positive
- Project slugs validated against `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/` (max 128 chars)

## Error Handling

- `ensureError()` normalizes all caught values to `Error` instances
- Step execution errors are captured in `NodeState.error` and propagated to `WorkflowRun.error`
- Workflow-level `onError` and executor-level `onError` callbacks are invoked on failure
- Timeout errors are thrown via `Promise.race()` with proper cleanup of timer IDs
- Lock acquisition failures throw descriptive errors about concurrent execution
- Redis connection errors are propagated; backend reconnection is handled via lazy `ensureClient()`
- Job entrypoints return exit codes: 0=success, 1=failed, 2=config error, 3=not found, 4=discovery failed

## Side Effects

- `workflow()` auto-registers in the global `workflowRegistry` singleton
- `WorkflowExecutor.start()` fires `executeAsync()` in the background (fire-and-forget with error logging)
- `ApprovalManager` starts an expiration-check interval timer on construction
- `WorkflowWorker` and `WorkflowJobManager` start polling timers via `setTimeout`
- Heartbeat intervals update run state in the backend every 10 seconds during execution
- Redis backend creates consumer groups on `initialize()`
- Blob storage writes files to disk, S3, or GCS

## Performance Constraints

- `maxConcurrency` (default: 10) limits parallel node execution batch size
- Map node respects per-node `concurrency` override
- Worker `concurrency` (default: 3) limits simultaneous stalled-run resumes
- Job manager `maxConcurrentJobs` (default: 10) limits active isolated jobs
- Redis `listRuns()` does N+1 queries (one per run ID) -- acceptable for moderate scale
- `structuredClone()` used extensively for checkpoint isolation -- deep copies all context

## Invariants

- A run in `"completed"` or `"failed"` status cannot be resumed or cancelled
- A run in `"waiting"` status has exactly one `waitingNode` set in `currentNodes`
- Node states only transition forward: `pending -> running -> completed/failed/skipped`
- Checkpoints contain deep clones; mutations to context after checkpoint do not affect stored state
- Each step execution is wrapped in `runWithWorkflowTenant()` for consistent tenant context
- The DAG executor never executes a node whose in-degree is non-zero (all dependencies must complete first)
- Approval decisions are idempotent: a processed approval cannot be re-processed (throws if status != "pending")
