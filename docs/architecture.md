# Veryfront Runtime Architecture

How the Proxy, App Server, Worker, and API work together.

## System Overview

```
                          ┌──────────────────────────────────────────────────────────────┐
                          │                          Internet                            │
                          └──────────────────────────┬───────────────────────────────────┘
                                                     │
                                            HTTPS (*.veryfront.com)
                                                     │
                          ┌──────────────────────────▼───────────────────────────────────┐
                          │                     Caddy                           │
                          │              (TLS termination + routing)                      │
                          └──────┬──────────────────┬────────────────────┬───────────────┘
                                 │                  │                    │
                        api.veryfront.com    *.veryfront.com      veryfront.com
                                 │                  │                    │
                                 ▼                  ▼                    ▼
                  ┌──────────────────┐  ┌───────────────────┐  ┌────────────────┐
                  │   veryfront-api  │  │      Proxy        │  │     Studio     │
                  │   (Node.js)      │  │      (Deno)       │  │   (React)      │
                  │                  │  │                    │  │                │
                  │  GraphQL API     │  │  Multi-tenant      │  │  Editor UI     │
                  │  Auth / OAuth    │  │  routing           │  │  Dashboard     │
                  │  Project DB      │  │                    │  │                │
                  │  File storage    │  │  Port 20000        │  │  Port 3000     │
                  │  Port 4000       │  └────────┬───────────┘  └────────────────┘
                  └──────┬───────────┘           │
                         │              HTTP + context headers
                         │                       │
                         │              ┌────────▼───────────┐
                         │              │    App Server       │
                         │              │    (Deno)           │
                         │              │                     │
                         │              │  SSR / RSC          │
                         │              │  API routes         │
                         │              │  Module serving     │
                         │              │  Middleware          │
                         │              │                     │
                         │              │  Port 3001          │
                         │              └────────┬───────────┘
                         │                       │
                         │          Workflow start (async)
                         │                       │
                         │              ┌────────▼───────────┐
                         │              │      Redis         │
                         │              │                     │
                         │              │  Job queue          │
                         │              │  Run state          │
                         │              │  Checkpoints        │
                         │              │  Distributed locks  │
                         │              └────────┬───────────┘
                         │                       │
                         │              Poll every 5s
                         │                       │
                         │              ┌────────▼───────────┐
                         │              │     Worker         │
                         │              │     (Deno)          │
                         │              │                     │
                         │              │  Job Manager        │
                         │              │  Process Executor   │
                         │              │  Stalled recovery   │
                         │              │                     │
                         │              └────────┬───────────┘
                         │                       │
                         │           Spawn per job (isolated)
                         │                       │
                         │              ┌────────▼───────────┐
                         │              │   Job Subprocess   │
                         │              │                     │
                         │              │  TENANT_* env vars  │
                         │              │  Workflow steps      │
                         │              │  Tool execution      │
                         │◄─────────────│  api.files.*        │
                              API calls │  api.project.*      │
                         (uses tenant   └────────────────────┘
                          token)
```

## Components

### Proxy

**CLI:** `veryfront serve --mode=proxy` (production) or part of `veryfront start` (dev)

The proxy is the entry point for all user-facing HTTP traffic. It resolves which project a request belongs to and injects tenant context for downstream services.

**Responsibilities:**
- Parse the request domain (`myproject.veryfront.com` -> slug `myproject`)
- Fetch an OAuth service token from the API
- Look up project metadata (projectId, releaseId, environment)
- Inject context headers: `x-token`, `x-project-slug`, `x-project-id`, `x-environment`, `x-release-id`
- Forward the enriched request to the App Server
- Proxy WebSocket connections (HMR in development)

**Why it exists separately:**
The proxy holds OAuth client credentials. In production, it runs as a separate process so the App Server (which executes user code via API routes, middleware, etc.) never has access to platform-level secrets.

### App Server

**CLI:** `veryfront serve` (production) or `veryfront dev` (development)

The App Server handles the actual request processing: rendering pages, executing API routes, serving modules, and running middleware.

**Responsibilities:**
- Extract tenant context from proxy headers
- Load project configuration (`veryfront.config.ts`)
- Execute the handler pipeline: auth, CORS, static files, modules, API routes, RSC, SSR
- Render React components to HTML (SSR/streaming)
- Execute server actions and API route handlers
- Serve compiled ES modules to the browser
- Start workflows when API routes call `client.start()`

**Request flow inside the server:**
```
Request arrives with context headers
    │
    ▼
Extract RequestContext (token, slug, projectId, environment, ...)
    │
    ▼
Load project config
    │
    ▼
Route registry (first match wins):
    ├── /health, /metrics         → Health handler
    ├── /_vf/modules/*            → Module server (ESM)
    ├── /api/*, /app/**/route.ts  → API route handler
    ├── /_vf/rsc/*                → React Server Components
    └── /*                        → SSR (render page to HTML)
```

### Worker

**CLI:** `veryfront worker`

The worker is a standalone background process that executes workflow jobs. It connects to Redis to pick up pending work and spawns isolated subprocesses for each job.

**Responsibilities:**
- Poll Redis for pending and stalled workflow runs
- Acquire distributed locks to prevent duplicate execution across workers
- Spawn isolated Deno subprocesses with tenant context as env vars
- Monitor running jobs (timeout, completion, failure)
- Detect and recover stalled runs (crashed processes, OOM kills)
- Report job statistics on shutdown

**It does NOT:**
- Handle HTTP requests
- Need proxy headers or OAuth secrets
- Know about the App Server's existence

The worker only needs a Redis URL. It operates completely independently.

### API (veryfront-api)

**Separate service** at `api.veryfront.com` — not part of veryfront-renderer.

The API is the source of truth for project metadata, files, authentication, and billing. Both the Proxy and workflow jobs call it.

**Used by the Proxy for:**
- Domain lookup (custom domain -> project slug)
- OAuth token exchange (client credentials -> service token)

**Used by workflow jobs for:**
- File operations (`api.files.list()`, `api.files.read()`)
- Project metadata (`api.project.get()`)
- Any tool that needs to read/write project data

### Redis

Redis serves as the coordination layer between the App Server and Worker:

| Data Structure | Purpose |
|---|---|
| `vf:workflow:run:{id}` (Hash) | Run state: status, input, output, tenant context, timestamps |
| `vf:workflow:index:status:{status}` (Set) | Index of run IDs by status (pending, running, completed, failed) |
| `vf:workflow:stream` (Stream) | Job queue with consumer groups |
| `vf:workflow:checkpoints:{id}` (List) | Ordered checkpoint snapshots for crash recovery |
| `vf:workflow:lock:{id}` (Key) | Distributed lock to prevent duplicate dispatch |
| `vf:workflow:claim:{id}` (Key) | Stalled run claim (atomic SET NX) |

## How They Connect

### Normal page request

```
Browser → Proxy → App Server → Response
```

1. Browser requests `myproject.veryfront.com/about`
2. Proxy resolves slug, fetches token, injects headers
3. App Server renders the page via SSR
4. HTML streams back through proxy to browser

### Workflow execution (async)

```
Browser → Proxy → App Server → Redis ← Worker → Subprocess
```

1. Browser POSTs to `/api/start-pipeline`
2. Proxy forwards with tenant context
3. App Server's API route calls `client.start("content-pipeline", input)`
4. Executor captures current tenant context (`getCurrentRequestContext()`)
5. Creates `WorkflowRun` with `_tenant` field, persists to Redis
6. Returns `{ runId }` immediately to browser
7. Worker polls Redis, finds pending run
8. Acquires lock, spawns subprocess with `TENANT_*` env vars
9. Subprocess discovers workflow from project files, executes steps
10. Each step's tools use `api.*` which resolves to the captured tenant
11. On completion, updates Redis with output
12. Browser polls `/api/status/{runId}` to get result

### Tenant context flow

The critical path that makes multi-tenancy work:

```
HTTP Request (has token + slug in proxy headers)
    │
    ▼
App Server extracts RequestContext
    │
    ▼
workflow executor.start() calls getCurrentRequestContext()
    │
    ▼
Captures _tenant: { projectSlug, token, projectId, productionMode, releaseId }
    │
    ▼
Persists on WorkflowRun in Redis
    │
    ▼
Worker reads run from Redis, passes _tenant to executor
    │
    ▼
ProcessJobExecutor injects as env vars:
    TENANT_PROJECT_SLUG=myproject
    TENANT_TOKEN=vf_xyz
    TENANT_PROJECT_ID=proj_123
    TENANT_PRODUCTION_MODE=1
    TENANT_RELEASE_ID=rel_456
    │
    ▼
Job entrypoint reads env vars, calls runWithRequestContext()
    │
    ▼
Workflow steps access api.* — uses captured tenant automatically
```

## Standalone Workflows (No API Required)

The workflow system is self-contained. Users can run workflows with just Redis and a worker — no proxy, no veryfront-api, no OAuth.

The only components that depend on the veryfront-api are:
- **Proxy**: needs OAuth tokens to resolve projects in multi-tenant mode
- **`api.files.*` / `api.project.*` helpers**: convenience wrappers for platform file operations

If your workflow tools use your own services (databases, external APIs, local files), none of that applies.

```
┌──────────────────┐     ┌──────────────┐     ┌──────────────┐
│  veryfront dev   │     │    Redis     │     │   veryfront  │
│  (App Server)    │────▶│              │◀────│   worker     │
│                  │     │  Job queue   │     │              │
│  API route calls │     │  Run state   │     │  Polls +     │
│  client.start()  │     │  Checkpoints │     │  executes    │
└──────────────────┘     └──────────────┘     └──────────────┘
                                                     │
                                              Spawns subprocess
                                                     │
                                                     ▼
                                              ┌──────────────┐
                                              │ Your tools   │
                                              │ Your DB      │
                                              │ Your APIs    │
                                              │ (no vf-api)  │
                                              └──────────────┘
```

**Example — standalone workflow with custom tools:**

```typescript
// app/workflows/etl-pipeline.ts
import { step, workflow } from "veryfront/workflow";
import { fetchFromDB, transformData, loadToWarehouse } from "../tools";

export const etlPipeline = workflow({
  id: "etl-pipeline",
  steps: [
    step("extract", { tool: fetchFromDB }),
    step("transform", { tool: transformData }),
    step("load", { tool: loadToWarehouse }),
  ],
});
```

```typescript
// app/api/run-etl/route.ts
import { WorkflowClient, RedisBackend } from "veryfront/workflow";
import { etlPipeline } from "../../workflows/etl-pipeline";

const client = new WorkflowClient({
  backend: new RedisBackend({ url: "redis://localhost:6379" }),
});
client.register(etlPipeline);

export async function POST(ctx) {
  const { runId } = await client.start("etl-pipeline", ctx.body);
  return ctx.json({ runId });
}
```

```bash
# Terminal 1
veryfront dev

# Terminal 2
veryfront worker --redis-url redis://localhost:6379
```

That's it. Redis is the only infrastructure dependency.

**When you DO need the API:**
- Using `api.files.*` to read/write files stored on the Veryfront platform
- Running in multi-tenant mode where the proxy resolves projects via OAuth
- Using `api.project.*` to access platform project metadata

**When you DON'T need the API:**
- Your tools talk to your own database, external APIs, or local filesystem
- Single-tenant deployment (one project, no domain routing)
- Self-hosted with your own auth

## Deployment Modes

### Local Development: `veryfront start`

Everything in one process. The proxy runs as middleware inside the dev server.

```
┌─────────────────────────────────────────┐
│           veryfront start               │
│                                         │
│   ┌─────────┐  ┌──────────────────┐    │
│   │  Proxy  │──│   App Server     │    │
│   │  (MW)   │  │   + HMR          │    │
│   └─────────┘  └──────────────────┘    │
│                                         │
│           Port 8080                     │
└─────────────────────────────────────────┘
```

No Redis needed. Workflows run inline (in-memory). Good for quick iteration.

### Local Development with Worker: `veryfront start` + `veryfront worker`

Two processes sharing Redis. Mirrors production topology locally.

```
┌─────────────────┐     ┌────────────────┐
│ veryfront start  │     │ veryfront worker│
│                  │     │                 │
│  Proxy + Server  │     │  Job Manager    │
│  Port 8080       │     │  + Executor     │
└────────┬─────────┘     └────────┬────────┘
         │                        │
         └───────┬────────────────┘
                 ▼
         ┌──────────────┐
         │    Redis     │
         └──────────────┘
```

Workflows survive server restarts. Worker detects stalled runs and recovers.

### Production Split Mode: `veryfront serve` (x2) + `veryfront worker`

Three process types, each independently scalable.

```
┌─────────┐   ┌─────────┐   ┌─────────┐
│ Proxy   │   │ Proxy   │   │ Proxy   │   ← Scale for traffic
│ :20000  │   │ :20000  │   │ :20000  │
└────┬────┘   └────┬────┘   └────┬────┘
     │              │              │
     └──────────────┼──────────────┘
                    ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│  Server  │  │  Server  │  │  Server  │  ← Scale for rendering
│  :3001   │  │  :3001   │  │  :3001   │
└────┬─────┘  └────┬─────┘  └────┬─────┘
     │              │              │
     └──────────────┼──────────────┘
                    ▼
             ┌──────────────┐
             │    Redis     │
             └──────┬───────┘
                    │
     ┌──────────────┼──────────────┐
     ▼              ▼              ▼
┌──────────┐  ┌──────────┐  ┌──────────┐
│  Worker  │  │  Worker  │  │  Worker  │  ← Scale for jobs
└──────────┘  └──────────┘  └──────────┘
```

**Proxy** holds OAuth secrets, forwards to servers.
**Servers** handle HTTP, start workflows.
**Workers** execute jobs in isolated subprocesses.

Each tier scales independently based on load profile.

### Veryfront Cloud (K8s Multi-Tenant)

Production with untrusted user code. The API is a required component — the proxy authenticates against it, and workflow jobs call it to access project files and metadata.

```
                     ┌──────────────────┐
                     │  veryfront-api   │
                     │  (Node.js)       │
                     │                  │
                     │  Auth / OAuth    │
                     │  Project DB      │
                     │  File storage    │
                     └──┬───────────┬───┘
                        │           │
             OAuth +    │           │  api.files.*
             domain     │           │  api.project.*
             lookup     │           │
                        │           │
┌──────────┐     ┌──────▼───┐     ┌─▼────────────┐
│  Proxy   │────▶│  Server  │────▶│    Redis     │
│  Pods    │     │  Pods    │     └──────┬───────┘
└──────────┘     └──────────┘            │
                                         ▼
                                  ┌──────────────┐
                                  │ Job Manager  │
                                  │ Pod          │
                                  └──────┬───────┘
                                         │
                          Creates K8s Jobs (ephemeral)
                                         │
                     ┌───────────────────┼───────────────────┐
                     ▼                   ▼                   ▼
              ┌────────────┐      ┌────────────┐      ┌────────────┐
              │  Job Pod   │      │  Job Pod   │      │  Job Pod   │
              │  tenant-a  │      │  tenant-b  │      │  tenant-c  │
              │            │      │            │      │            │
              │  Uses API  │      │  Uses API  │      │  Uses API  │
              │  w/ tenant │      │  w/ tenant │      │  w/ tenant │
              │  token     │      │  token     │      │  token     │
              └────────────┘      └────────────┘      └────────────┘
                    │                   │                   │
              Terminated           Terminated           Terminated
              after done           after done           after done
```

**How the API is involved in cloud mode:**

| Component | API interaction |
|---|---|
| **Proxy** | OAuth token exchange (client credentials → service token), domain → project lookup |
| **Server** | Fetches project files + config for SSR rendering |
| **Job Pods** | Each job gets a tenant-scoped token via `TENANT_TOKEN` env var, uses `api.files.*` and `api.project.*` to read/write that tenant's data |

Each tenant's workflow runs in a fresh container with:
- Process isolation (no shared memory)
- Separate credentials (`TENANT_TOKEN` scoped to that project)
- Resource limits (CPU, memory)
- Automatic cleanup on completion

## CLI Commands

| Command | What it starts | Typical use |
|---|---|---|
| `veryfront dev` | Dev server with HMR | Local development (single project) |
| `veryfront start` | Proxy + Server + TUI | Local development (multi-project, MCP) |
| `veryfront serve` | Production server | Deployment (supports `--mode=proxy`, `--mode=production`) |
| `veryfront worker` | Workflow job worker | Background job execution |

### Worker options

```bash
veryfront worker [options]

Options:
  --redis-url <url>          Redis connection URL (default: redis://localhost:6379)
  -c, --concurrency <n>      Max concurrent jobs (default: 3)
  --poll-interval <ms>       Poll interval in ms (default: 5000)
  --stalled-threshold <ms>   Time before a run is considered stalled (default: 60000)
  -e, --executor <type>      Job executor: process | k8s (default: process)
  --entrypoint <path>        Path to job entrypoint script (default: ./workflow-job.ts)
  --debug                    Enable debug logging
```

### Examples

```bash
# Local dev with default settings
veryfront worker

# Production with higher concurrency
veryfront worker --redis-url redis://prod:6379 --concurrency 10

# Custom entrypoint with debug logging
veryfront worker --entrypoint ./src/jobs/workflow-runner.ts --debug
```

## Key Design Decisions

**Why separate Proxy and Server?**
Security. The proxy holds OAuth client credentials for the platform API. The server executes user code (API routes, middleware, server actions). Separating them ensures user code can never access platform secrets.

**Why separate Worker and Server?**
Independence. Workers don't need to handle HTTP. They scale based on job volume, not request volume. A spike in page views doesn't affect workflow throughput and vice versa.

**Why Redis?**
It provides both the persistence layer (run state, checkpoints) and coordination primitives (distributed locks, atomic claims) needed for multi-worker crash recovery. The stream data type handles job queueing with consumer groups.

**Why subprocess isolation?**
Workflow steps execute user-defined tools and agents. Running them in the server process would let a misbehaving workflow block request handling. Subprocesses provide fault isolation — a crashed or hung workflow only affects its own job.

**Why capture tenant context at workflow start?**
Workers run asynchronously, potentially minutes or hours after the HTTP request that triggered the workflow. The original request context (token, project ID) must be persisted with the run so the worker can restore it when executing steps.
