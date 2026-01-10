# Veryfront Workflow

Durable, DAG-based workflows with automatic crash recovery and multi-tenant isolation.

## Quick Start (Local Development)

```bash
veryfront dev
```

Define workflows and use them in your API routes:

```typescript
// app/workflows/content-pipeline.ts
import { workflow, step, parallel } from "veryfront/ai/workflow";

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
import { WorkflowClient } from "veryfront/ai/workflow";
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
import {
  WorkflowClient,
  WorkflowWorker,
  RedisBackend,
} from "veryfront/ai/workflow";
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
    resumeFn: (runId) => workflowClient.resume(runId),
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

For multi-tenant SaaS with untrusted user code, we use K8s Job isolation:

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
│                    │  (Job Queue)     │                         │
│                    └──────────────────┘                         │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                 Job Manager Pod                          │   │
│  │  • Polls Redis for pending workflows                     │   │
│  │  • Creates K8s Job per workflow                          │   │
│  │  • Never executes user code                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│              ┌───────────────┼───────────────┐                  │
│              ▼               ▼               ▼                  │
│       ┌───────────┐   ┌───────────┐   ┌───────────┐            │
│       │  Job Pod  │   │  Job Pod  │   │  Job Pod  │            │
│       │ tenant-a  │   │ tenant-b  │   │ tenant-c  │            │
│       │ ephemeral │   │ ephemeral │   │ ephemeral │            │
│       └───────────┘   └───────────┘   └───────────┘            │
│            ↓               ↓               ↓                    │
│       Terminated      Terminated      Terminated                │
│       after done      after done      after done                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Why K8s Jobs for multi-tenant?**

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

# Job Manager mode (multi-tenant)
MODE=job-manager                     # Run as job manager only
JOB_NAMESPACE=workflows              # K8s namespace for jobs
JOB_IMAGE=veryfront-renderer:latest  # Image for job pods
JOB_TIMEOUT=1800000                  # 30 minute timeout
```

### Programmatic Configuration

```typescript
import {
  WorkflowClient,
  WorkflowWorker,
  RedisBackend
} from "veryfront/ai/workflow";

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
  resumeFn: (runId) => client.resume(runId),
  pollInterval: 5000,
  stalledThreshold: 60000,
});
worker.start();
```

### Job Executors (Pluggable Runtimes)

The `WorkflowJobManager` uses a pluggable `JobExecutor` interface, allowing workflows to run on different runtimes:

```typescript
import {
  WorkflowJobManager,
  K8sJobExecutor,
  ProcessJobExecutor,
  RedisBackend,
} from "veryfront/ai/workflow";

const backend = new RedisBackend({ url: process.env.REDIS_URL });

// Production: Kubernetes Jobs
const k8sExecutor = new K8sJobExecutor({
  image: "my-app:latest",
  namespace: "workflows",
  resources: {
    requests: { cpu: "100m", memory: "256Mi" },
    limits: { cpu: "1", memory: "1Gi" },
  },
}, k8sClient);

// Local development: Child processes
const processExecutor = new ProcessJobExecutor({
  entrypointPath: "./job-entrypoint.ts",
  env: { REDIS_URL: process.env.REDIS_URL },
});

// Same manager interface for both
const manager = new WorkflowJobManager({
  backend,
  executor: process.env.NODE_ENV === "production" ? k8sExecutor : processExecutor,
  maxConcurrentJobs: 10,
  jobTimeout: 30 * 60 * 1000, // 30 minutes
});

await manager.start();
```

**Available Executors:**

| Executor | Use Case | Isolation |
|----------|----------|-----------|
| `K8sJobExecutor` | Production multi-tenant | Full container isolation |
| `ProcessJobExecutor` | Local development | Process-level isolation |

**Creating a Custom Executor:**

```typescript
import type { JobExecutor, JobConfig, JobInfo } from "veryfront/ai/workflow";

class DockerJobExecutor implements JobExecutor {
  async createJob(config: JobConfig): Promise<string> {
    // Spawn a Docker container
  }

  async getJobStatus(jobId: string): Promise<JobInfo | null> {
    // Check container status
  }

  async listJobs(managerId: string): Promise<JobInfo[]> {
    // List containers with manager label
  }

  async deleteJob(jobId: string): Promise<void> {
    // Remove container
  }
}
```

## Multi-Tenant Support

Tenant context is automatically captured and restored:

```typescript
// Your tool - no tenant awareness needed
import { api } from "veryfront/ai";

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
- Job pods (context passed via environment)

## Deployment Modes Summary

| Mode | Use Case | Code Trust | Isolation | Executor |
|------|----------|------------|-----------|----------|
| **Dev (simple)** | Local development | Your code | None needed | In-process (`WorkflowWorker`) |
| **Dev (jobs)** | Local with job isolation | Your code | Process per workflow | `ProcessJobExecutor` |
| **Self-hosted** | Single-tenant prod | Your code | Shared process OK | In-process (`WorkflowWorker`) |
| **Cloud** | Multi-tenant SaaS | User code | Container per workflow | `K8sJobExecutor` |

**Key decision:** If workflows execute untrusted user-defined code, use `K8sJobExecutor` for container isolation. For local development that mirrors production behavior, use `ProcessJobExecutor`.

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
