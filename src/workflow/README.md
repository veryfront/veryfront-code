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

For automatic crash recovery during development, add Redis and a worker:

```typescript
// app/lib/workflow-client.ts
import { RedisBackend, WorkflowClient, WorkflowWorker } from "veryfront/workflow";
import { contentPipeline } from "../workflows/content-pipeline";

// Shared Redis backend
const backend = new RedisBackend({
  url: process.env.REDIS_URL || "redis://localhost:6379",
});

// Shared client
export const workflowClient = new WorkflowClient({ backend });
workflowClient.register(contentPipeline);

// Start worker (runs in the same process)
// Only do this once - typically in a startup file
if (process.env.WORKER_ENABLED !== "false") {
  const worker = new WorkflowWorker({
    backend,
    resumeFn: (runId, expectedWorkerId) => workflowClient.resume(runId, expectedWorkerId),
    pollInterval: 5000,
    stalledThreshold: 30000, // 30s for dev (faster detection)
  });
  worker.start();
}
```

Now if your dev server crashes mid-workflow:

1. Restart `veryfront dev`
2. Worker detects stalled workflows
3. Resumes from last checkpoint

## How It Works

### Local Development

**Default (Simple):** Workflows run inline, no persistence:

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
      - REDIS_URL=redis://redis:6379
      - WORKER_ENABLED=true
    deploy:
      replicas: 3

  redis:
    image: redis:7-alpine
```

Each pod runs both HTTP server and workflow worker. Redis handles coordination:

- Checkpoints stored in Redis
- Heartbeats detect stalled workflows
- Distributed locking prevents duplicate execution

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

### Environment Variables

```bash
# Backend
REDIS_URL=redis://localhost:6379     # Use Redis (default: in-memory)

# Worker mode
WORKER_ENABLED=true                  # Enable in-process worker
WORKER_POLL_INTERVAL=5000            # Poll every 5 seconds
WORKER_STALLED_THRESHOLD=60000       # Consider stalled after 60 seconds
WORKER_CONCURRENCY=3                 # Max concurrent workflow resumes

# Workflow run manager mode (multi-tenant)
MODE=workflow-run-manager            # Run as workflow run manager only
RUN_EXECUTION_NAMESPACE=workflows    # Runtime namespace for run executions
RUN_EXECUTION_IMAGE=veryfront-renderer:latest
RUN_EXECUTION_TIMEOUT=1800000        # 30 minute timeout
```

### Programmatic Configuration

```typescript
import { RedisBackend, WorkflowClient, WorkflowWorker } from "veryfront/workflow";

// Backend
const backend = new RedisBackend({
  url: process.env.REDIS_URL,
  prefix: "wf:",
});

// Client
const client = new WorkflowClient({ backend });
client.register(myWorkflow);

// Optional: Start worker (if not using CLI)
const worker = new WorkflowWorker({
  backend,
  resumeFn: (runId, expectedWorkerId) => client.resume(runId, expectedWorkerId),
  pollInterval: 5000,
  stalledThreshold: 60000,
});
worker.start();
```

Custom backends used by `WorkflowWorker` must implement the queue, lock, and stalled-run methods in
`WorkflowBackend`. They must also implement `updateRunIfStatusAndWorker`,
`saveCheckpointIfStatusAndWorker`, and `savePendingApprovalIfStatusAndWorker`. Each of these methods
must compare the run status and worker ID atomically with its write. `WorkflowWorker` rejects a
backend that omits these owner-fencing operations because an older worker could otherwise overwrite
a replacement worker's progress.

### Redis run queries and retention maintenance

The built-in Memory and Redis backends return runs in stable `(createdAt DESC, id DESC)` order. Run
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

`RedisBackend` preserves configured key, stream, and consumer-group values as deployment base names
and appends the versioned `schema-v2` namespace. Readers and workers inspect only their exact schema
namespace. They do not dual-read, migrate, or backfill unversioned or `schema-v1` rows and queue
entries. A mixed v1/v2 deployment therefore splits run state and is unsupported.

Run creation is create-only in both built-in backends. Reusing a live run ID rejects with the
structured `workflow-run-conflict` error (HTTP status `409`) and leaves the original run and its
indexes unchanged. Redis publishes the run hash, status/workflow/all-run indexes, retention metadata,
and optional hash TTL in one Lua operation, so readers cannot observe a partially created run.

When `runTtl` is configured, checkpoints and approvals inherit the run's remaining retention horizon
instead of starting a new TTL when they are written. Redis keeps an ordered deadline index plus the
workflow and status metadata needed for targeted cleanup without scanning the keyspace. Run reads,
listings, counts, and deletes recheck missing hashes inside atomic cleanup scripts, so lazy expiry
cannot leave countable ghosts or delete a concurrently recreated run. List and count operations use
the ordered v2 indexes and never enumerate the entire run population with `SMEMBERS` or `KEYS`.

Both built-in backends reject unconditional checkpoint or approval writes when the owning run does
not exist. Owner-fenced checkpoint writes may use a synthetic storage run ID, but their lifetime and
permission remain tied to the existing canonical ownership run.

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
import { ProcessRunExecutor, RedisBackend, WorkflowRunManager } from "veryfront/workflow";

const backend = new RedisBackend({ url: process.env.REDIS_URL });

const processExecutor = new ProcessRunExecutor({
  entrypointPath: "./run-entrypoint.ts",
  env: { REDIS_URL: process.env.REDIS_URL },
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

**Creating a Custom Executor:**

```typescript
import type { RunExecutionConfig, RunExecutionInfo, RunExecutor } from "veryfront/workflow";

class DockerRunExecutor implements RunExecutor {
  async createRunExecution(config: RunExecutionConfig): Promise<string> {
    // Spawn a Docker container
  }

  async getRunExecutionStatus(executionId: string): Promise<RunExecutionInfo | null> {
    // Check container status
  }

  async listRunExecutions(managerId: string): Promise<RunExecutionInfo[]> {
    // List containers with manager label
  }

  async deleteRunExecution(executionId: string): Promise<void> {
    // Remove container
  }
}
```

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
