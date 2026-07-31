# Veryfront Workflow

Durable, DAG-based workflows with automatic crash recovery and multi-tenant isolation.

## Quick Start (Local Development)

```bash
veryfront dev
```

Define workflows and use them in your API routes:

```typescript
// app/workflows/content-pipeline.ts
import { parallel, step, workflow } from "veryfront/workflow";

export const contentPipeline = workflow({
  id: "content-pipeline",
  steps: [
    step("research", { agent: "researcher" }),
    parallel("generate", [
      step("write", { agent: "writer" }),
      step("images", { tool: "image-generator" }),
    ]),
    step("publish", { agent: "publisher" }),
  ],
});
```

```typescript
// app/api/start-pipeline/route.ts
import { WorkflowClient } from "veryfront/workflow";
import { contentPipeline } from "../../workflows/content-pipeline";

const client = new WorkflowClient();
client.register(contentPipeline);

export async function POST(ctx: APIContext) {
  const handle = await client.start("content-pipeline", {
    topic: ctx.body.topic,
  });

  return ctx.json({ runId: handle.runId });
}
```

**Note:** By default, workflows use in-memory storage. For crash recovery, see [Enabling Crash Recovery](#enabling-crash-recovery-local-dev).

## Enabling Crash Recovery (Local Dev)

For automatic crash recovery during development, install and explicitly activate
`@veryfront/ext-redis`, then add a worker:

```typescript
// app/lib/workflow-client.ts
import { createDistributedWorkflowBackend, WorkflowClient } from "veryfront/workflow";
import { WorkflowWorker } from "veryfront/workflow/worker";
import { contentPipeline } from "../workflows/content-pipeline";

// Application startup must activate the extensions in veryfront.config.ts
// before this module requests the provider-neutral backend.
const backend = createDistributedWorkflowBackend({});

// The provider transfers this dedicated backend to its caller. The client owns
// it, while the worker borrows it until worker.stop() completes.
export const workflowClient = new WorkflowClient({ backend });
workflowClient.register(contentPipeline);
await workflowClient.initialize();

// Application composition explicitly decides whether to start this process-local worker.
const worker = new WorkflowWorker({
  backend,
  resumeFn: (runId, expectedWorkerId) => workflowClient.resume(runId, expectedWorkerId),
  pollInterval: 5000,
  stalledThreshold: 30000, // 30s for dev (faster detection)
});
worker.start();

export async function stopWorkflowRuntime(): Promise<void> {
  await worker.stop();
  await workflowClient.destroy();
}
```

Explicit initialization fails startup before the worker accepts work. Shutdown
stops the borrowing worker before destroying the owning client and its dedicated
backend. Extension teardown does not close provider-factory results that were
transferred to callers.

Now if your dev server crashes mid-workflow:

1. Restart `veryfront dev`
2. Worker detects stalled workflows
3. Resumes from last checkpoint

## How It Works

### Local Development

**Default (Simple):** Workflows run inline with process-local, non-durable persistence:

```
┌───────────────────────────────────────┐
│            veryfront dev              │
│                                       │
│  ┌─────────────────────────────────┐  │
│  │         HTTP Server             │  │
│  │                                 │  │
│  │  • Handle routes                │  │
│  │  • Execute workflows inline     │  │
│  │  • In-memory checkpoints        │  │
│  └─────────────────────────────────┘  │
└───────────────────────────────────────┘
```

- **Zero configuration** - Just use `veryfront dev`
- **Fast iteration** - No container overhead
- **Note:** No crash recovery (workflows lost on restart)

**With Redis (Crash Recovery):** Add optional worker:

```
┌─────────────────────────────────────────────────────┐
│                  veryfront dev                      │
│                                                     │
│  ┌───────────────────┐  ┌───────────────────────┐  │
│  │   HTTP Server     │  │   Workflow Worker     │  │
│  │   (Renderer)      │  │   (In-Process)        │  │
│  │                   │  │                       │  │
│  │  • Handle routes  │  │  • Poll for stalled   │  │
│  │  • Start flows    │  │  • Resume crashed     │  │
│  │  • Execute steps  │  │  • Heartbeat          │  │
│  └───────────────────┘  └───────────────────────┘  │
│            │                       │               │
│            └───────────┬───────────┘               │
│                        ▼                           │
│               ┌─────────────────┐                  │
│               │      Redis      │                  │
│               │  (Checkpoints)  │                  │
│               └─────────────────┘                  │
└─────────────────────────────────────────────────────┘
```

- Requires Redis (local or Docker)
- Workflows survive server restarts
- See [Enabling Crash Recovery](#enabling-crash-recovery-local-dev)

### Production (Self-Hosted)

For simple production deployments, you can scale horizontally with Redis:

```yaml
# docker-compose.yml
services:
  app:
    image: my-app:latest
    environment:
      - REDIS_URL=rediss://cache.internal:6380
    command: ["veryfront", "serve"]
    deploy:
      replicas: 3

  worker:
    image: my-app:latest
    environment:
      - REDIS_URL=rediss://cache.internal:6380
    command: ["veryfront", "worker", "--entrypoint", "./workflow-run.ts"]
    deploy:
      replicas: 2
```

The web and worker profiles activate the same project extension configuration;
the distributed provider handles coordination:

- Checkpoints stored in Redis
- Heartbeats detect stalled workflows
- Token-fenced lease locking and atomic lease-bound run transitions prevent stale owners from publishing state

Set the heartbeat interval to no more than one third of the lock duration. This
leaves two renewal windows before the lease expires; the executor rejects less
conservative timing configurations.

Lease locking does not make external side effects exactly once across process
pauses or partitions. Treat tool effects as at least once and use idempotency
keys or provider-side fencing for mutations.

### Veryfront Cloud (Multi-Tenant)

For multi-tenant SaaS with untrusted user code, Veryfront Cloud uses isolated run execution:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Veryfront Cloud                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Web Pods (Proxy)                      │   │
│  │  • Handle HTTP requests                                  │   │
│  │  • Enqueue workflows to Redis                            │   │
│  │  • Don't execute user code                               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│                    ┌──────────────────┐                         │
│                    │      Redis       │                         │
│                    │  (Run Queue)     │                         │
│                    └──────────────────┘                         │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Workflow Run Manager Pod                    │   │
│  │  • Polls Redis for pending workflows                     │   │
│  │  • Creates one isolated execution per workflow            │   │
│  │  • Never executes user code                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│              ┌───────────────┼───────────────┐                  │
│              ▼               ▼               ▼                  │
│       ┌───────────┐   ┌───────────┐   ┌───────────┐            │
│       │ Run Pod   │   │ Run Pod   │   │ Run Pod   │            │
│       │ tenant-a  │   │ tenant-b  │   │ tenant-c  │            │
│       │ ephemeral │   │ ephemeral │   │ ephemeral │            │
│       └───────────┘   └───────────┘   └───────────┘            │
│            ↓               ↓               ↓                    │
│       Terminated      Terminated      Terminated                │
│       after done      after done      after done                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Why isolated runs for multi-tenant?**

Workflows execute **user-defined code** (tools, agents, custom logic). In a multi-tenant environment:

```
Tenant A's workflow:
  step("process", { tool: maliciousTool })  // Could read memory, env vars, etc.

Tenant B's workflow:
  step("process", { tool: legitimateTool })  // Running in same process = vulnerable
```

**Security requirements:**

- Complete process isolation between tenants
- No shared memory or state (prevents data exfiltration)
- Fresh container for each workflow (no persistent backdoors)
- Separate credentials per tenant (injected via env vars)
- Resource limits per tenant (prevents DoS)
- Automatic cleanup after completion (no lingering processes)

## Configuration

### Provider configuration and CLI worker options

```bash
REDIS_URL=redis://localhost:6379
veryfront worker --concurrency 3 --poll-interval 5000 --stalled-threshold 60000
```

`REDIS_URL` configures the explicitly activated `ext-redis`; it never selects
the backend. Worker concurrency and timing are CLI options, not hidden
environment switches.

### Programmatic Configuration

```typescript
import { createDistributedWorkflowBackend, WorkflowClient } from "veryfront/workflow";
import { WorkflowWorker } from "veryfront/workflow/worker";

// Backend
const backend = createDistributedWorkflowBackend({
  prefix: "wf:",
});

// The client owns the dedicated provider result. The worker below borrows it.
const client = new WorkflowClient({ backend });
client.register(myWorkflow);
await client.initialize();

// Optional: Start worker (if not using CLI)
const worker = new WorkflowWorker({
  backend,
  resumeFn: (runId, expectedWorkerId) => client.resume(runId, expectedWorkerId),
  pollInterval: 5000,
  stalledThreshold: 60000,
});
worker.start();

export async function stopWorkflowRuntime(): Promise<void> {
  await worker.stop();
  await client.destroy();
}
```

#### Workflow client readiness and backend ownership

`WorkflowClient` separates client-local execution resources from persistence
ownership.

| Surface                               | Contract                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First persistence operation           | Lazily initializes the backend. Concurrent operations join the same readiness attempt.                                                                                    |
| `initialize()`                        | Starts an explicit readiness attempt, including revalidation after an earlier success.                                                                                    |
| Failed readiness                      | Is retained and replayed to ordinary persistence operations. A later explicit `initialize()` starts the retry; no operation silently falls back to another backend.       |
| Registration and collaborator getters | `register()`, `registerAll()`, `getBackend()`, `getExecutor()`, and `getApprovalManager()` are synchronous and do not initialize persistence.                             |
| `destroy()`                           | Closes admission, quiesces admitted client work, and tears down the executor and approval manager. Concurrent calls share an attempt; a failed attempt remains retryable. |

`backendOwnership` has two exact values:

| Value        | Backend lifetime                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `"owned"`    | Default. The client destroys its implicit or injected backend after client-local work is quiescent.                               |
| `"borrowed"` | Requires an explicit backend. The client leaves that backend open; its external owner must destroy it after every borrower stops. |

Distributed provider factories transfer each returned backend to their caller;
extension teardown does not destroy those dedicated results. Use the default
`"owned"` mode when one client receives the backend. Use `"borrowed"` only when
another composition-root owner will stop every borrower and destroy the backend
exactly once.

For example, a composition root that intentionally shares one backend between
two clients owns the backend separately from both borrowers:

```typescript
import { createDistributedWorkflowBackend, WorkflowClient } from "veryfront/workflow";

const sharedBackend = createDistributedWorkflowBackend({});
const apiClient = new WorkflowClient({
  backend: sharedBackend,
  backendOwnership: "borrowed",
});
const maintenanceClient = new WorkflowClient({
  backend: sharedBackend,
  backendOwnership: "borrowed",
});

await apiClient.initialize();
await maintenanceClient.initialize();

// During shutdown, stop every borrower before destroying the shared backend.
await apiClient.destroy();
await maintenanceClient.destroy();
await sharedBackend.destroy();
```

#### Custom backend contract

Custom backends used by `WorkflowWorker` must implement the queue, lock, and stalled-run methods in
`WorkflowBackend`. They must also implement `updateRunIfStatusAndWorker`,
`saveCheckpointIfStatusAndWorker`, and `savePendingApprovalIfStatusAndWorker`. Each of these methods
must compare the run status and worker ID atomically with its write. `WorkflowWorker` rejects a
backend that omits these owner-fencing operations because an older worker could otherwise overwrite
a replacement worker's progress. Lock support is likewise one complete capability: `acquireLock`
returns an opaque ownership token, and both `extendLock` and `releaseLock` require that token and
atomically compare it with the live lease. Renewal and release return `true` only when they changed
the matching lease and `false` for a missing, expired, or replacement lease.
`updateRunIfStatusAndLock` atomically compares the live lease, expected status, and optional worker
before changing run state; a transition away from `running` consumes that same lease in the
transaction. A backend that omits any one of these four operations is not lock-capable; there is no
token cache, unfenced update, or unconditional release compatibility path.

##### Approval lookup migration

Custom `WorkflowBackend` implementations must provide the required
`getApproval(runId, approvalId)` method. It replaces the removed optional
`getPendingApproval(runId, approvalId)` method; there is no compatibility
fallback. The plural `getPendingApprovals(runId)` remains the actionable-list
operation, while exact `getApproval` lookup returns the unique record in any
decision state. A backend must fail closed when legacy storage contains more
than one record with the requested ID.

### Redis run queries and retention maintenance

The core memory backend and the Redis extension backend return runs in stable
`(createdAt DESC, id DESC)` order. Run
IDs at equal creation times use Redis's UTF-8 byte ordering. `listRuns()` defaults to 100 rows and
accepts at most 1,000 rows per call. Its public `offset` range is 0 through 10,000, inclusive. Callers
must use an explicit offset in that range to fetch later pages. Creation-time boundaries are
inclusive. A run snapshot and its live pending approvals come from one backend snapshot; returned
objects are detached from backend storage.

Each Redis page is read by one atomic `EVAL`, but a multi-page traversal is not one global snapshot.
Internal approval and stalled-run polling use bounded `(score, runId)` cursor pages and de-duplicate
run IDs when a missing or changed cursor forces a restart. Runs inserted before the current cursor,
and runs that move between status or workflow indexes during traversal, may appear in a later polling
cycle.

Redis list and count operations are exact. Each query first performs one bounded retention-cleanup
pass of at most 128 due entries. If more cleanup is already due, or if the query repairs an index
ghost, the operation fails with the retryable `service-overloaded` error (HTTP `503`) instead of
returning a partial or stale answer. Run bounded maintenance on a schedule and alert whenever the
backlog survives the allowed passes:

```typescript
const MAX_DRAIN_PASSES_PER_TICK = 8;

for (let pass = 0; pass < MAX_DRAIN_PASSES_PER_TICK; pass++) {
  const result = await backend.drainExpiredRuns();
  // Export `result.processed` and `result.hasMoreDue` to your metrics backend here.
  if (!result.hasMoreDue) break;
}
```

Schedule the bounded loop more frequently than the configured retention horizon. Treat a persistent
`hasMoreDue` value or query `503` as an operational backlog: continue draining and retry the query
with backoff. Do not convert the error to an empty list or approximate count.

### Redis schema-v2 cutovers

The `@veryfront/ext-redis` workflow backend preserves configured key, stream, and consumer-group
values as deployment base names
and appends the versioned `schema-v2` namespace. Readers and workers inspect only their exact schema
namespace. They do not dual-read, migrate, or backfill unversioned or `schema-v1` rows and queue
entries. A mixed v1/v2 deployment therefore splits run state and is unsupported.

Run creation is create-only in both built-in backends. Reusing a live run ID rejects with the
structured `workflow-run-conflict` error (HTTP status `409`) and leaves the original run and its
indexes unchanged. Redis publishes the run hash, status/workflow/all-run indexes, retention metadata,
and optional hash TTL in one Lua operation, so readers cannot observe a partially created run.

Status-conditional run patches use the mandatory `updateRunIfStatus` backend compare-and-set. The
status check and patch are one operation: `true` means the patch was applied and `false` means the
current status did not match. There is no read-then-write compatibility path. Backends must also
implement `listPendingApprovals`; expiration and operator queries do not silently skip unsupported
storage.

When `runTtl` is configured, checkpoints and approvals inherit the run's remaining retention horizon
instead of starting a new TTL when they are written. Redis keeps an ordered deadline index plus the
workflow and status metadata needed for targeted cleanup without scanning the keyspace. Run reads,
listings, counts, and deletes recheck missing hashes inside atomic cleanup scripts, so lazy expiry
cannot leave countable ghosts or delete a concurrently recreated run. List and count operations use
the ordered v2 indexes and never enumerate the entire run population with `SMEMBERS` or `KEYS`.

Both built-in backends reject unconditional checkpoint or approval writes when the owning run does
not exist. Owner-fenced checkpoint writes may use a synthetic storage run ID, but their lifetime and
permission remain tied to the existing canonical ownership run.

Approval IDs are unique for the lifetime of a run. Both unconditional and owner-fenced approval
appends reserve the ID atomically, require the run to still be `waiting`, and reject duplicates.
`updateApproval` is a mandatory compare-and-set over the owning run status, approval status, and
persisted expiry. Its required timing argument contains the host-captured `decidedAt` and either the
`unexpired` or `expired` predicate. The backend compares the persisted expiry and writes that exact
timestamp in the same transaction; equality with `expiresAt` is still on time. The method returns
`true` only for the decision that changed a pending approval and `false` when any predicate lost a
race. Notification failure metadata is the only non-decision approval patch; attempts to patch
status or decision fields are rejected. If legacy storage already contains duplicate approval IDs,
decision writes, metadata updates, and exact reads fail closed without choosing an arbitrary row.

Pending-approval lists and hydrated run snapshots expose actionable approvals only while the run is
`waiting`. Exact `getApproval` lookup intentionally returns historical decided or stranded
records as well; approval reconciliation and operator audit depend on that distinction. Retrying the
exact same durable decision re-runs run-state reconciliation without changing `decidedAt`; a retry
whose outcome, approver, or comment differs is rejected. Approval timeouts must be positive portable
timer durations. `ApprovalManager.destroy()` stops new approval mutations and waits for admitted
creation and decision operations plus an in-flight expiry pass.

Approval decision identities must come from an authenticated host boundary, never from an
untrusted request field. An explicit `approvers` list is enforced by the workflow runtime. Omitting
that list delegates the whole authorization decision to the host that calls the approval API.

These atomic run-state scripts require one logical Redis keyspace. The built-in adapter supports a
standalone Redis endpoint. Redis Sentinel and Redis Cluster are not currently supported: the built-in
adapter does not expose Sentinel discovery, and the scripts derive status and workflow index keys from
stored run data, so a hash-tagged prefix alone does not satisfy Redis Cluster's requirement that every
accessed key be declared to `EVAL`. Use a standalone Redis endpoint or provide a different
`WorkflowBackend` implementation.

For the default configuration, v2 state is rooted at `vf:workflow:schema-v2:` and the queue and group
are `vf:workflow:stream:schema-v2` and `vf:workflow:workers:schema-v2`. Custom `prefix`, `streamKey`,
and `groupName` values retain the same suffix rules. Inspect only these known keys; do not use `KEYS`
against a production Redis instance.

Use this deployment protocol for the v1-to-v2 cutover:

1. Stop new workflow intake while the v1 fleet remains healthy.
2. Let v1 workers finish or explicitly cancel every `pending`, `running`, and `waiting` run. With the
   default prefix, verify the three `vf:workflow:schema-v1:index:status:<status>` sets with `SCARD`.
3. Verify `XPENDING vf:workflow:stream:schema-v1 vf:workflow:workers:schema-v1` reports zero pending
   messages and `XINFO GROUPS vf:workflow:stream:schema-v1` reports zero lag for the v1 group. Stream
   length need not be zero because acknowledged entries may remain in stream history.
4. Stop every v1 worker and reader. Deploy all v2 readers and writers together, then reopen intake.
5. Monitor query `503` rates, retention backlog, v2 queue lag, and pending counts. Keep v1 data and a
   pre-cutover backup for the rollback window; remove them only under the normal retention policy.

Rollback is another coordinated cutover. Stop intake, drain or cancel all active v2 runs, verify the
three `vf:workflow:schema-v2:index:created:status:<status>` sorted indexes with `ZCARD`, and verify
zero pending/lag for the v2 stream and group. Then stop every v2 process and deploy all v1 readers
and writers together. Never run v1 and v2 workflow processes concurrently. If an emergency prevents
a v2 drain, the only safe v1 rollback is restoring the pre-cutover Redis backup and accepting the
documented loss of post-cutover v2 work; v1 cannot consume v2 state.

### Run Executors

The `WorkflowRunManager` uses a `RunExecutor` interface for isolated local process execution. In Veryfront Cloud, task and workflow runs execute through the project runtime target via the canonical Runs API.

```typescript
import { createDistributedWorkflowWorkerResources } from "veryfront/workflow";
import { ProcessRunExecutor, WorkflowRunManager } from "veryfront/workflow/worker";

const { backend, environment } = await createDistributedWorkflowWorkerResources({});

const processExecutor = new ProcessRunExecutor({
  entrypointPath: "./run-entrypoint.ts",
  env: { ...environment },
});

const manager = new WorkflowRunManager({
  backend,
  executor: processExecutor,
  maxConcurrentExecutions: 10,
  executionTimeout: 30 * 60 * 1000, // 30 minutes
});

await manager.start();
```

**Available Executors:**

| Executor             | Use Case                         | Isolation               |
| -------------------- | -------------------------------- | ----------------------- |
| `ProcessRunExecutor` | Local development, trusted hosts | Process-level isolation |

#### Custom executor reference

`RunExecutor`, `RunExecutionConfig`, and `RunExecutionInfo` are exported from
`veryfront/workflow/worker`.

##### Example adapter

```typescript
import type { RunExecutionConfig, RunExecutionInfo, RunExecutor } from "veryfront/workflow/worker";

interface ManagedExecutionRuntime {
  spawn(input: {
    executionId: string;
    managerId: string;
    runId: string;
    entrypoint: string;
    timeout: number;
    debug: boolean;
    env: Readonly<Record<string, string>>;
  }): Promise<void>;
  get(executionId: string): Promise<RunExecutionInfo | null>;
  list(managerId: string): Promise<RunExecutionInfo[]>;
  terminateAndRemove(executionId: string): Promise<void>;
  shutdown(): Promise<void>;
}

class ManagedRunExecutor implements RunExecutor {
  constructor(
    private readonly runtime: ManagedExecutionRuntime,
    private readonly entrypoint: string,
  ) {
    if (entrypoint.trim().length === 0) {
      throw new TypeError("Managed workflow entrypoint must not be empty");
    }
  }

  async createRunExecution(config: RunExecutionConfig): Promise<string> {
    await this.runtime.spawn({
      executionId: config.executionId,
      managerId: config.managerId,
      runId: config.run.id,
      entrypoint: this.entrypoint,
      timeout: config.timeout,
      debug: config.debug ?? false,
      env: {
        ...config.env,
        MODE: "run",
        WORKFLOW_RUN_ID: config.run.id,
        RUN_EXECUTION_ID: config.executionId,
        WORKFLOW_LOCK_DURATION_MS: String(config.lockAcquisition.duration),
        WORKFLOW_LOCK_ACQUISITION_TIMEOUT_MS: String(config.lockAcquisition.timeout),
        WORKFLOW_LOCK_RETRY_INTERVAL_MS: String(config.lockAcquisition.retryInterval),
      },
    });
    return config.executionId;
  }

  getRunExecutionStatus(executionId: string): Promise<RunExecutionInfo | null> {
    return this.runtime.get(executionId);
  }

  listRunExecutions(managerId: string): Promise<RunExecutionInfo[]> {
    return this.runtime.list(managerId);
  }

  async deleteRunExecution(executionId: string): Promise<void> {
    await this.runtime.terminateAndRemove(executionId);
  }

  async destroy(): Promise<void> {
    await this.runtime.shutdown();
  }
}
```

The injected runtime in the example owns the platform-specific process, container, or runtime-target
operations. Its `spawn()` method returns when the execution is registered and addressable.

##### Method contract

| Method                               | Required behavior                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createRunExecution(config)`         | Registers the execution under `config.executionId` and returns exactly that ID as soon as status, list, and delete operations can address it. It does not wait for entrypoint readiness, child lock acquisition, or workflow completion. A rejected partial spawn leaves no live execution, or leaves it addressable by `config.executionId` for cleanup. |
| `getRunExecutionStatus(executionId)` | Returns the current execution record, or `null` when the execution is not present.                                                                                                                                                                                                                                                                        |
| `listRunExecutions(managerId)`       | Returns the active executions registered by the specified manager.                                                                                                                                                                                                                                                                                        |
| `deleteRunExecution(executionId)`    | Is idempotent and resolves only after the execution can no longer perform workflow work.                                                                                                                                                                                                                                                                  |
| `initialize()`                       | Optionally initializes the executor once before its first execution is created. If initialization rejects after allocating resources, the manager invokes `destroy()` and the executor becomes terminal.                                                                                                                                                  |
| `destroy()`                          | Performs terminal teardown and resolves only after every owned execution can no longer perform workflow work. Repeated calls join the same teardown or remain safe and idempotent.                                                                                                                                                                        |

##### Managed entrypoint environment

`RunExecutionConfig.lockAcquisition` contains positive millisecond values for the isolated
entrypoint's bounded lease acquisition.

| Reserved variable                      | Value                                          |
| -------------------------------------- | ---------------------------------------------- |
| `MODE`                                 | `run`                                          |
| `WORKFLOW_RUN_ID`                      | `config.run.id`                                |
| `RUN_EXECUTION_ID`                     | `config.executionId`                           |
| `WORKFLOW_LOCK_DURATION_MS`            | `String(config.lockAcquisition.duration)`      |
| `WORKFLOW_LOCK_ACQUISITION_TIMEOUT_MS` | `String(config.lockAcquisition.timeout)`       |
| `WORKFLOW_LOCK_RETRY_INTERVAL_MS`      | `String(config.lockAcquisition.retryInterval)` |

The reserved variables are applied after host-, executor-, and run-supplied environment values and
cannot be overridden by them. The execution invokes a standard managed workflow entrypoint with
these variables.

##### Managed entrypoint lifecycle

`createWorkflowRunEntrypoint()` and
`createDynamicWorkflowRunEntrypoint()` await backend readiness before returning
a `WorkflowRunEntrypoint`. The factories own the backend and runtime resources
they allocate.

| Surface                       | Lifecycle contract                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entrypoint()`                | Starts the handle's only run. Concurrent or later invocations fail closed. The promise settles only after automatic cleanup of factory-owned resources. |
| `entrypoint.destroy()`        | Abandons a ready handle, or joins an active invocation before cleanup. Completed cleanup is idempotent; failed cleanup may be retried.                  |
| Execution and cleanup failure | Rejects with an `AggregateError` that preserves both failures instead of replacing the execution error.                                                 |
| `runWorkflowRun()`            | Borrows a pre-initialized backend and executor. Their lifecycle remains with the caller.                                                                |
| `runDynamicWorkflowRun()`     | Borrows a pre-initialized backend. Its per-run executor and approval manager are disposed after execution, while the backend remains with the caller.   |

Calling `destroy()` is required when a factory-created handle is abandoned
before invocation. Calling it after invocation is safe because invocation has
already joined automatic cleanup.

`WorkflowRunManager.stop()` is terminal because executor teardown is terminal. Construct a new
manager and executor to start processing again.

See [Workflow runtime](../../docs/architecture/08-workflow-runtime.md#manager-to-entrypoint-lease-handoff)
for the lease handoff and
[managed entrypoint ownership](../../docs/architecture/08-workflow-runtime.md#managed-entrypoint-ownership)
for the lifecycle rationale.

## Multi-Tenant Support

Tenant context is automatically captured and restored:

```typescript
// Your tool - no tenant awareness needed
import { api } from "veryfront/workflow";

const fetchFileTool = {
  id: "fetch-file",
  execute: async (input) => {
    // api automatically uses the correct tenant
    return await api.files.read(input.path);
  },
};
```

When a workflow starts within an HTTP request:

1. Tenant context is captured from the request
2. Context is stored with the workflow checkpoint
3. When steps execute, context is restored
4. `api` calls automatically use the correct tenant

This works across:

- Crash recovery (context restored from checkpoint)
- Different pods (context in Redis)
- Process run executors (context passed via environment)

## Deployment Modes Summary

| Mode             | Use Case                 | Code Trust | Isolation            | Executor                      |
| ---------------- | ------------------------ | ---------- | -------------------- | ----------------------------- |
| **Dev (simple)** | Local development        | Your code  | None needed          | In-process (`WorkflowWorker`) |
| **Dev (runs)**   | Local with run isolation | Your code  | Process per workflow | `ProcessRunExecutor`          |
| **Self-hosted**  | Single-tenant prod       | Your code  | Shared process OK    | In-process (`WorkflowWorker`) |
| **Cloud**        | Multi-tenant SaaS        | User code  | Runtime target       | Canonical Runs API            |

**Key decision:** Veryfront Cloud executes task and workflow runs on the selected project runtime target. Kubernetes scheduling, when present, is an infrastructure detail and is not part of the client execution model.

## Architecture Deep Dive

### Checkpointing

Every step saves a checkpoint to Redis:

```
Workflow: content-pipeline
├── Step: research ✓ (checkpoint saved)
├── Step: generate
│   ├── write ✓ (checkpoint saved)
│   └── images ✓ (checkpoint saved)  ← crash here
└── Step: publish (not started)
```

On recovery, the workflow resumes from the last checkpoint:

- Completed steps are skipped
- Failed steps can be retried
- Waiting steps (approval) continue waiting

### Source integration policy snapshots

Every new workflow run stores the normalized source integration policy that was active when the
run started. Resume, worker, and process entrypoints require this snapshot and restore it before
executing workflow code.

If dynamic discovery reloads a narrower source policy, the runtime intersects it with the stored
snapshot. A reload cannot widen the run's original integration or tool access. Runs without a
snapshot are rejected; missing state never implies unrestricted access.

### Heartbeat & Stalled Detection

Running workflows send heartbeats every 10 seconds:

```
Pod 1: Running workflow wf_abc123
        └── Heartbeat: 10:00:00
        └── Heartbeat: 10:00:10
        └── Heartbeat: 10:00:20
        └── [Pod crashes]

Pod 2: Worker polling...
        └── Found wf_abc123, last heartbeat 10:00:20
        └── Current time: 10:01:30 (70s stale)
        └── Threshold: 60s
        └── Claiming workflow...
        └── Resuming from checkpoint
```

### Distributed Locking

When multiple workers try to claim the same stalled workflow:

```
Pod 1: claimStalledRun("wf_abc123", "worker-1") → true (wins)
Pod 2: claimStalledRun("wf_abc123", "worker-2") → false (loses)
Pod 3: claimStalledRun("wf_abc123", "worker-3") → false (loses)
```

The claim is atomic in Redis - only one worker can win.
