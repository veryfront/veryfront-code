# Claude Code SDK Integration

Integrate Anthropic's Claude Code SDK into Veryfront workflows for powerful agentic coding capabilities.

## Overview

This module provides a harness for running Claude Code SDK agents within Veryfront's durable workflow system. It combines:

- **Claude Code SDK**: Anthropic's agentic coding capabilities (bash, file editing, computer use)
- **Veryfront Workflows**: Durability, multi-tenancy, human-in-the-loop
- **Tenant-Aware Operations**: File operations scoped to the current project

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Veryfront Workflow                          │
│  ┌─────────┐    ┌─────────────────┐    ┌─────────────────────┐  │
│  │  step   │───▶│ ClaudeCodeAgent │───▶│ waitForApproval     │  │
│  └─────────┘    └────────┬────────┘    └─────────────────────┘  │
│                          │                                       │
│         ┌────────────────┼────────────────┐                      │
│         ▼                ▼                ▼                      │
│  ┌────────────┐  ┌────────────┐  ┌────────────────┐             │
│  │ BashTool   │  │ FileTool   │  │ ComputerTool   │             │
│  │ (sandbox)  │  │ (api.files)│  │ (optional)     │             │
│  └────────────┘  └────────────┘  └────────────────┘             │
│         │                │                                       │
│         ▼                ▼                                       │
│  ┌────────────────────────────────────┐                         │
│  │     Tenant Context (AsyncLocal)    │                         │
│  │  - projectSlug, token, projectId   │                         │
│  └────────────────────────────────────┘                         │
└─────────────────────────────────────────────────────────────────┘
```

## Features

### 1. Built-in Tool Modes

| Mode       | Tools Enabled     | Use Case                    |
| ---------- | ----------------- | --------------------------- |
| `code`     | bash, file editor | Code modifications, scripts |
| `analysis` | file reader only  | Code review, analysis       |
| `custom`   | User-specified    | Fine-grained control        |

`bypassPermissions` remains available only as an explicit server-side
`AgentConfig` opt-in. It is not a user-facing tool mode.

### 2. Tenant-Aware File Operations

All file operations automatically use the current project context:

```typescript
// Tool uses api.files internally - no tenant passing needed
await agent.run("Read the package.json and update dependencies");
// Automatically reads from current tenant's project
```

### 3. Sandbox Modes

| Mode         | Description               | Use Case         |
| ------------ | ------------------------- | ---------------- |
| `strict`     | Containerized, no network | Untrusted code   |
| `permissive` | Process isolation only    | Trusted code     |
| `none`       | Direct execution          | Development only |

### 4. Checkpointing

Long-running agent tasks are checkpointed:

- After each tool execution
- On agentic loop iterations
- Before human approval requests

## Usage

### Basic: As a Workflow Tool

```typescript
import { step, workflow } from "veryfront/workflow";

export const codeFix = workflow({
  id: "code-fix",
  steps: [
    step("fix", {
      tool: "claude-code",
      input: (ctx) => ({
        task: ctx.input.issue,
        mode: "code",
        maxIterations: 10,
      }),
    }),
  ],
});
```

### Advanced: Custom Agent Configuration

```typescript
import { claudeCodeAgent } from "veryfront/workflow/claude-code";

const agent = claudeCodeAgent({
  model: "claude-sonnet-4-20250514",
  mode: "code",
  sandbox: "strict",

  // Custom tools alongside built-ins
  tools: {
    runTests: myTestRunner,
    deployPreview: myDeployTool,
  },

  // Callbacks for observability
  onToolCall: (tool, input) => console.log(`Calling ${tool}`),
  onIteration: (i, result) => console.log(`Iteration ${i}`),
});

// Use in workflow
export const migration = workflow({
  id: "migration",
  steps: [
    step("migrate", { agent }),
    waitForApproval("review"),
    step("apply", { tool: "git-commit" }),
  ],
});
```

### With Human-in-the-Loop

```typescript
export const safeMigration = workflow({
  id: "safe-migration",
  steps: [
    // Agent proposes changes
    step("propose", {
      tool: "claude-code",
      input: { task: "Migrate to React 19", mode: "analysis" },
    }),

    // Human reviews proposed changes
    waitForApproval("review-changes", {
      message: "Review proposed migration changes",
      payload: (ctx) => ctx.propose.changes,
    }),

    // Agent applies approved changes
    step("apply", {
      tool: "claude-code",
      input: (ctx) => ({
        task: `Apply these changes: ${JSON.stringify(ctx.propose.changes)}`,
        mode: "code",
      }),
    }),

    // Human reviews final result
    waitForApproval("review-final"),

    step("commit", { tool: "git-commit" }),
  ],
});
```

## API Reference

### `claudeCodeAgent(config)`

Create a Claude Code agent for use in workflows.

```typescript
interface ClaudeCodeAgentConfig {
  /** Model to use (default: claude-sonnet-4-20250514) */
  model?: string;

  /** Tool mode: 'code' | 'analysis' | 'custom' */
  mode?: ClaudeCodeMode;

  /** Sandbox mode: 'strict' | 'permissive' | 'none' */
  sandbox?: SandboxMode;

  /** Maximum agentic loop iterations */
  maxIterations?: number;

  /** Custom tools to add */
  tools?: Record<string, Tool>;

  /** System prompt override */
  system?: string;

  /** Callbacks */
  onToolCall?: (tool: string, input: unknown) => void;
  onIteration?: (iteration: number, result: unknown) => void;
  onComplete?: (result: ClaudeCodeResult) => void;
}
```

### `claudeCodeTool`

Pre-configured tool for use in workflow steps.

```typescript
interface ClaudeCodeToolInput {
  /** Task description for the agent */
  task: string;

  /** Tool mode */
  mode?: ClaudeCodeMode;

  /** Maximum iterations */
  maxIterations?: number;

  /** Files to focus on (optional) */
  files?: string[];

  /** Additional context */
  context?: Record<string, unknown>;
}
```

### Built-in Tools

#### `bash` (type: bash_20250124)

Execute shell commands in sandbox.

#### `file_editor` (type: text_editor_20250124)

Edit files using str_replace operations.

#### `file_reader`

Read files from project (uses `api.files.read`).

#### `computer` (type: computer_20250124)

Computer use for UI automation (optional, requires setup).

## Security Considerations

### File Access

- All file operations scoped to tenant project
- Path traversal protection enabled
- No access outside project root

### Shell Execution

- Commands run in isolated container (strict mode)
- Network access disabled by default
- Resource limits enforced (CPU, memory, time)

### Secrets

- Environment variables not passed to sandbox
- API keys managed via Veryfront config
- Tenant tokens never exposed to agent

## Examples

### Code Review Agent

```typescript
export const codeReview = workflow({
  id: "code-review",
  steps: [
    step("review", {
      tool: "claude-code",
      input: (ctx) => ({
        task: `Review the following PR changes for:
          - Security issues
          - Performance problems
          - Code style violations

          Files: ${ctx.input.files.join(", ")}`,
        mode: "analysis",
      }),
    }),
  ],
});
```

### Dependency Updater

```typescript
export const updateDeps = workflow({
  id: "update-deps",
  steps: [
    step("analyze", {
      tool: "claude-code",
      input: {
        task: "Analyze package.json and find outdated dependencies",
        mode: "analysis",
      },
    }),

    step("update", {
      tool: "claude-code",
      input: (ctx) => ({
        task: `Update these dependencies: ${ctx.analyze.outdated.join(", ")}`,
        mode: "code",
      }),
    }),

    step("test", { tool: "run-tests" }),

    waitForApproval("review"),

    step("commit", {
      tool: "git-commit",
      input: { message: "chore: update dependencies" },
    }),
  ],
});
```

### Bug Fix Agent

```typescript
export const bugFix = workflow({
  id: "bug-fix",
  steps: [
    step("reproduce", {
      tool: "claude-code",
      input: (ctx) => ({
        task: `Reproduce this bug: ${ctx.input.issueDescription}`,
        mode: "code",
      }),
    }),

    step("fix", {
      tool: "claude-code",
      input: (ctx) => ({
        task: `Fix the bug. Root cause: ${ctx.reproduce.rootCause}`,
        mode: "code",
        maxIterations: 15,
      }),
    }),

    step("verify", {
      tool: "claude-code",
      input: {
        task: "Run tests to verify the fix",
        mode: "code",
      },
    }),

    waitForApproval("review-fix"),
  ],
});
```

## Configuration

### Environment Variables

```bash
# Required
ANTHROPIC_API_KEY=sk-ant-...

# Optional
CLAUDE_CODE_SANDBOX=strict          # strict | permissive | none
CLAUDE_CODE_MAX_ITERATIONS=20       # Default max iterations
CLAUDE_CODE_TIMEOUT=300000          # Timeout per iteration (ms)
```

### Veryfront Config

```typescript
// veryfront.config.ts
export default {
  ai: {
    claudeCode: {
      enabled: true,
      defaultModel: "claude-sonnet-4-20250514",
      sandbox: "strict",
      maxIterations: 20,
      timeout: "5m",
    },
  },
};
```

## Streaming

Real-time streaming of Claude Code execution is supported via Server-Sent Events (SSE).

### Setting Up Streaming

#### 1. Create SSE Endpoint

```typescript
// app/api/workflows/[runId]/stream/route.ts
import type { APIContext } from "veryfront";
import { RedisEventPublisher } from "veryfront/workflow/claude-code";

export async function GET(ctx: APIContext) {
  const { runId } = ctx.params;

  // Create Redis subscriber
  const publisher = new RedisEventPublisher({
    url: Deno.env.get("REDIS_URL")!,
  });

  // Create SSE stream
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const unsubscribe = await publisher.subscribe(runId, (event) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );

        if (event.type === "complete" || event.type === "error") {
          controller.close();
          unsubscribe();
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
```

#### 2. Configure Agent with Publisher

```typescript
import { RedisEventPublisher, streamingClaudeCodeAgent } from "veryfront/workflow/claude-code";

const publisher = new RedisEventPublisher({
  url: Deno.env.get("REDIS_URL")!,
});

const agent = streamingClaudeCodeAgent({
  streaming: {
    enabled: true,
    publisher,
  },
  runId: "my-run-id",
});
```

#### 3. Consume in React

```tsx
import { useClaudeCodeStream } from "veryfront/workflow/claude-code/react";

function AgentViewer({ runId }: { runId: string }) {
  const {
    isRunning,
    text,
    currentTool,
    toolCalls,
    result,
    error,
    currentIteration,
    maxIterations,
  } = useClaudeCodeStream({
    url: "/api/workflows/stream",
    runId,
  });

  return (
    <div>
      {/* Progress indicator */}
      {isRunning && (
        <div>
          Iteration {currentIteration}/{maxIterations}
          {currentTool && ` - Running ${currentTool.name}...`}
        </div>
      )}

      {/* Streaming text output */}
      <pre className="whitespace-pre-wrap">{text}</pre>

      {/* Tool calls */}
      <div className="space-y-2">
        {toolCalls.map((tc) => (
          <div key={tc.id} className={tc.isError ? "text-red-500" : ""}>
            <strong>{tc.name}</strong>
            <pre>{JSON.stringify(tc.input, null, 2)}</pre>
            {tc.output && <pre>{tc.output}</pre>}
          </div>
        ))}
      </div>

      {/* Error */}
      {error && <div className="text-red-500">{error}</div>}

      {/* Result */}
      {result && (
        <div>
          <h3>Complete!</h3>
          <p>Modified {result.filesModified.length} files</p>
          <p>Executed {result.commandsExecuted.length} commands</p>
        </div>
      )}
    </div>
  );
}
```

### Event Types

| Event                | Description             |
| -------------------- | ----------------------- |
| `iteration_start`    | New iteration beginning |
| `text_delta`         | Text chunk (streaming)  |
| `text_complete`      | Full text response      |
| `tool_call_start`    | Tool execution starting |
| `tool_call_input`    | Tool input streaming    |
| `tool_call_complete` | Tool input complete     |
| `tool_result`        | Tool execution result   |
| `iteration_complete` | Iteration finished      |
| `complete`           | Agent finished          |
| `error`              | Error occurred          |

### Publisher Options

| Type                     | Use Case                 |
| ------------------------ | ------------------------ |
| `RedisEventPublisher`    | Distributed deployments  |
| `MemoryEventPublisher`   | Single-process / testing |
| `SSEEventPublisher`      | Direct HTTP streaming    |
| `CallbackEventPublisher` | Custom handling          |

## Bidirectional Streaming (WebSocket)

For interactive features like cancellation, approval flows, and user input, use WebSocket instead of SSE.

### SSE vs WebSocket

```
SSE (One-way):
┌──────────┐                    ┌──────────┐
│  Client  │◄────── events ─────│  Server  │
│  (React) │                    │  (SSE)   │
└──────────┘                    └──────────┘

WebSocket (Bidirectional):
┌──────────┐◄────────────────────►┌──────────┐
│  Client  │    events + commands │  Server  │
│  (React) │◄────────────────────►│  (WS)    │
└──────────┘                      └──────────┘
```

| Feature            | SSE                | WebSocket          |
| ------------------ | ------------------ | ------------------ |
| Events to client   | ✅                 | ✅                 |
| Cancel agent       | ❌ (separate HTTP) | ✅                 |
| Approve tool calls | ❌ (separate HTTP) | ✅                 |
| User input mid-run | ❌                 | ✅                 |
| Keepalive          | Manual             | Built-in ping/pong |

### Setting Up WebSocket

#### 1. Create WebSocket Endpoint

```typescript
// app/api/agent/ws/route.ts
import {
  AgentController,
  createWebSocketHandler,
  RedisEventPublisher,
  streamingClaudeCodeAgent,
} from "veryfront/workflow/claude-code";

export const GET = createWebSocketHandler({
  getRunId: (req) => new URL(req.url).searchParams.get("runId"),

  onConnection: async (publisher, runId) => {
    // Create agent controller for handling commands
    const controller = new AgentController(publisher, {
      approvalTimeout: 60000,
      onCancel: (reason) => {
        console.log(`Agent cancelled: ${reason}`);
        // Cleanup logic here
      },
    });

    // Subscribe to Redis events (from worker)
    const redisPublisher = new RedisEventPublisher({
      url: Deno.env.get("REDIS_URL")!,
    });

    await redisPublisher.subscribe(runId, (event) => {
      publisher.send(event);
    });

    // Forward commands to worker via Redis
    publisher.onCommand(async (command) => {
      await redisPublisher.publish({
        type: "command",
        command,
        runId,
        timestamp: Date.now(),
      });
    });
  },

  onClose: (runId) => {
    console.log(`Client disconnected: ${runId}`);
  },
});
```

#### 2. Consume in React with Bidirectional Hook

```tsx
import { useClaudeCodeWebSocket } from "veryfront/workflow/claude-code/react";

function InteractiveAgent({ runId }: { runId: string }) {
  const {
    isRunning,
    isCancelled,
    text,
    currentTool,
    toolCalls,
    pendingApprovals,
    pendingInput,
    result,
    error,
    // Actions
    cancel,
    approve,
    reject,
    sendInput,
  } = useClaudeCodeWebSocket({
    url: "/api/agent/ws",
    runId,
  });

  return (
    <div>
      {/* Streaming output */}
      <pre className="whitespace-pre-wrap">{text}</pre>

      {/* Current tool */}
      {currentTool && (
        <div className="animate-pulse">
          Running: {currentTool.name}...
        </div>
      )}

      {/* Approval requests */}
      {pendingApprovals.map((pa) => (
        <div key={pa.toolCallId} className="border p-4 rounded">
          <p className="font-bold">Approve {pa.toolName}?</p>
          <p className="text-sm text-gray-600">{pa.reason}</p>
          <pre className="text-xs bg-gray-100 p-2 my-2">
            {JSON.stringify(pa.input, null, 2)}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={() => approve(pa.toolCallId)}
              className="bg-green-500 text-white px-4 py-2 rounded"
            >
              Approve
            </button>
            <button
              onClick={() => reject(pa.toolCallId, "User rejected")}
              className="bg-red-500 text-white px-4 py-2 rounded"
            >
              Reject
            </button>
          </div>
        </div>
      ))}

      {/* Input request */}
      {pendingInput && (
        <div className="border p-4 rounded">
          <p>{pendingInput.prompt}</p>
          <input
            type="text"
            defaultValue={pendingInput.defaultValue}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                sendInput(e.currentTarget.value);
              }
            }}
            className="border p-2 w-full"
          />
        </div>
      )}

      {/* Cancel button */}
      {isRunning && !isCancelled && (
        <button
          onClick={() => cancel("User cancelled")}
          className="bg-red-500 text-white px-4 py-2 rounded mt-4"
        >
          Cancel
        </button>
      )}

      {/* Result */}
      {result && (
        <div className="bg-green-100 p-4 rounded mt-4">
          <h3>Complete!</h3>
          <p>Modified {result.filesModified.length} files</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-100 text-red-700 p-4 rounded mt-4">
          {error}
        </div>
      )}

      {/* Cancelled */}
      {isCancelled && (
        <div className="bg-yellow-100 p-4 rounded mt-4">
          Agent was cancelled
        </div>
      )}
    </div>
  );
}
```

### Client Commands

| Command   | Description                       |
| --------- | --------------------------------- |
| `cancel`  | Stop agent execution              |
| `approve` | Approve a pending tool call       |
| `reject`  | Reject a pending tool call        |
| `input`   | Send user input to agent          |
| `ping`    | Keepalive (handled automatically) |

### Server Events (Extended)

| Event              | Description              |
| ------------------ | ------------------------ |
| `approval_request` | Tool needs user approval |
| `input_request`    | Agent needs user input   |
| `cancelled`        | Agent was cancelled      |
| `pong`             | Response to ping         |

### Tool Approval Configuration

Require approval for dangerous operations:

```typescript
const agent = streamingClaudeCodeAgent({
  mode: "code",
  streaming: { enabled: true, publisher },
  // Require approval for these tools
  approval: {
    requireApproval: ["bash"],
    dangerousPatterns: [
      /rm\s+-rf/,
      /git\s+push/,
      /npm\s+publish/,
    ],
    autoApproveTimeout: 30000, // Auto-approve after 30s
    timeoutAction: "reject", // Or "approve"
  },
});
```

## Deployment Architecture

Claude Code agents require long-running compute for agentic loops (1-30 minutes). This section covers deployment options.

### Compute Requirements

| Component        | Duration        | Serverless | Stateful    |
| ---------------- | --------------- | ---------- | ----------- |
| SSE endpoint     | Client lifetime | ⚠️ Limited | ✅ Ideal    |
| Agent execution  | 1-30 minutes    | ❌ Poor    | ✅ Required |
| Event publishing | Instant         | ✅ Great   | ✅ Great    |

**Why serverless is limited:**

- Execution timeouts (Vercel: 10-300s, Lambda: 15min max)
- Cold starts break SSE connections
- Can't hold WebSocket/SSE open across requests

### Recommended Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Serverless (JIT) - Renderer                                │
│  ┌───────────────────┐   ┌────────────────────────────────┐ │
│  │ POST /api/start   │   │ GET /api/stream (SSE)          │ │
│  │ - Validate input  │   │ - Subscribe to Redis           │ │
│  │ - Enqueue job     │   │ - Forward events to client     │ │
│  │ - Return runId    │   │ - Auto-close on complete       │ │
│  └─────────┬─────────┘   └──────────────┬─────────────────┘ │
└────────────│────────────────────────────│───────────────────┘
             │                            │
             ▼                            ▼
       ┌──────────┐              ┌──────────────┐
       │  Redis   │◄────────────►│   Redis      │
       │  Queue   │              │   Pub/Sub    │
       └────┬─────┘              └──────────────┘
            │                            ▲
            ▼                            │ publish events
┌───────────────────────────────────────────────────────────────┐
│  Stateful Worker - Agent Executor                             │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ Job Executor                                            │  │
│  │ - Dequeue jobs from Redis                               │  │
│  │ - Run Claude Code agent loop (1-30 min)                 │  │
│  │ - Execute tools (bash, file editor)                     │  │
│  │ - Publish events to Redis pub/sub                       │  │
│  │ - Update job state on completion                        │  │
│  └─────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
```

**Key benefits:**

- SSE endpoint is serverless-safe (just reads from Redis)
- Agent execution runs on dedicated stateful worker
- Redis provides durability across restarts
- Scales worker independently from frontend

### Alternative: Chunked Execution (Serverless-Only)

If you must run fully serverless, break agent into iterations:

```
┌─────────────────────────────────────────────────────────────┐
│  Request 1: Start                                           │
│  POST /api/agent/start                                      │
│  → Initialize state in Redis                                │
│  → Enqueue first iteration                                  │
│  → Return runId                                             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Request 2-N: Iterations (triggered by queue/cron)          │
│  POST /api/agent/iterate?runId=xxx                          │
│  → Load state from Redis                                    │
│  → Single Anthropic API call                                │
│  → Execute tools                                            │
│  → Save state to Redis                                      │
│  → Enqueue next iteration (if tool_use)                     │
│  → Publish events to Redis                                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Polling/SSE: Client                                        │
│  GET /api/agent/stream?runId=xxx                            │
│  → Subscribe to Redis pub/sub                               │
│  → Forward events until complete                            │
└─────────────────────────────────────────────────────────────┘
```

**Trade-offs:**

- ✅ Works on serverless
- ❌ Higher latency (cold starts between iterations)
- ❌ More complex state management
- ❌ Redis round-trips add overhead

### Helm Chart Configuration

Add agent worker to your deployment:

```yaml
# chart/values.yaml

# Existing renderer (serverless JIT)
renderer:
  enabled: true
  replicaCount: 2
  # ... existing config

# NEW: Agent worker for Claude Code execution
worker:
  enabled: true
  replicaCount: 1

  image:
    repository: ghcr.io/veryfront/veryfront-renderer
    pullPolicy: IfNotPresent
    tag: ""

  # Worker runs same image, different entrypoint
  command: ["deno", "run", "-A", "src/ai/workflow/worker/main.ts"]

  resources:
    requests:
      cpu: "500m"
      memory: "1Gi"
    limits:
      cpu: "2000m"
      memory: "2Gi"

  env:
    # Worker mode
    WORKER_MODE: "1"
    # Redis for job queue and events
    REDIS_URL: "redis://redis:6379"
    # Anthropic API
    ANTHROPIC_API_KEY_FROM: "secret"
    # Concurrency (jobs processed in parallel)
    WORKER_CONCURRENCY: "2"
    # Job timeout (30 minutes)
    WORKER_JOB_TIMEOUT: "1800000"
    # Logging
    LOG_FORMAT: "json"
    OTEL_SERVICE_NAME: "veryfront-worker"

  envFrom:
    - secretRef:
        name: veryfront-worker-secret

  # No external service needed (internal only)
  service:
    enabled: false

  # Health check via Redis connectivity
  readinessProbe:
    exec:
      command: ["deno", "eval", "await Deno.connect({hostname:'redis',port:6379})"]
    periodSeconds: 30
    timeoutSeconds: 10

  # No HPA - workers scale based on queue depth (external metric)
  autoscaling:
    enabled: false
```

### Worker Implementation

```typescript
// src/ai/workflow/worker/main.ts
import { JobExecutor } from "../executor/job-executor.ts";
import { createRedisBackend } from "../backends/redis.ts";
import { RedisEventPublisher, streamingClaudeCodeAgent } from "../claude-code/index.ts";

const REDIS_URL = Deno.env.get("REDIS_URL")!;
const CONCURRENCY = parseInt(Deno.env.get("WORKER_CONCURRENCY") || "2");

// Create Redis backend for job queue
const backend = createRedisBackend({ url: REDIS_URL });

// Create job executor
const executor = new JobExecutor({
  backend,
  concurrency: CONCURRENCY,

  // Handle Claude Code jobs
  handlers: {
    "claude-code": async (job) => {
      const publisher = new RedisEventPublisher({ url: REDIS_URL });

      try {
        const agent = streamingClaudeCodeAgent({
          mode: job.input.mode || "code",
          maxIterations: job.input.maxIterations || 20,
          streaming: {
            enabled: true,
            publisher,
          },
          runId: job.runId,
        });

        const result = await agent.generate({
          input: job.input.task,
          context: job.context || {},
        });

        return { success: true, result };
      } finally {
        await publisher.close();
      }
    },
  },

  // Error handling
  onError: (job, error) => {
    console.error(`[Worker] Job ${job.id} failed:`, error);
  },
});

// Start processing
console.log(`[Worker] Starting with concurrency ${CONCURRENCY}`);
await executor.start();

// Graceful shutdown
Deno.addSignalListener("SIGTERM", async () => {
  console.log("[Worker] Shutting down...");
  await executor.stop();
  Deno.exit(0);
});
```

### API Routes

```typescript
// app/api/agent/start/route.ts
import type { APIContext } from "veryfront";
import { createRedisBackend } from "veryfront/workflow/backends/redis";

export async function POST(ctx: APIContext) {
  const { task, mode, maxIterations } = await ctx.json();

  const backend = createRedisBackend({
    url: Deno.env.get("REDIS_URL")!,
  });

  // Enqueue job for worker
  const runId = crypto.randomUUID();
  await backend.enqueue({
    id: runId,
    type: "claude-code",
    input: { task, mode, maxIterations },
    context: {
      projectSlug: ctx.projectSlug,
      token: ctx.token,
    },
  });

  return ctx.json({ runId });
}
```

```typescript
// app/api/agent/[runId]/stream/route.ts
import type { APIContext } from "veryfront";
import { RedisEventPublisher } from "veryfront/workflow/claude-code";

export async function GET(ctx: APIContext) {
  const { runId } = ctx.params;

  const publisher = new RedisEventPublisher({
    url: Deno.env.get("REDIS_URL")!,
  });

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // Send initial connection event
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "connected", runId })}\n\n`),
      );

      const unsubscribe = await publisher.subscribe(runId, (event) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );

        if (event.type === "complete" || event.type === "error") {
          controller.close();
          unsubscribe();
          publisher.close();
        }
      });
    },
    cancel() {
      publisher.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
```

### Scaling Considerations

| Scenario       | Worker Replicas | Notes                                |
| -------------- | --------------- | ------------------------------------ |
| Development    | 0 (inline)      | Run agent in-process for simplicity  |
| Low traffic    | 1               | Single worker, 2 concurrent jobs     |
| Medium traffic | 2-3             | Scale based on queue depth           |
| High traffic   | 3-5 + HPA       | Use KEDA for queue-based autoscaling |

**Queue-based autoscaling with KEDA:**

```yaml
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: veryfront-worker-scaler
spec:
  scaleTargetRef:
    name: veryfront-worker
  minReplicaCount: 1
  maxReplicaCount: 5
  triggers:
    - type: redis
      metadata:
        address: redis:6379
        listName: veryfront:jobs:pending
        listLength: "5" # Scale up when > 5 pending jobs
```

### Monitoring

**Key metrics to track:**

```typescript
// Worker metrics
const metrics = {
  // Job processing
  "worker.jobs.started": Counter,
  "worker.jobs.completed": Counter,
  "worker.jobs.failed": Counter,
  "worker.jobs.duration": Histogram,

  // Agent metrics
  "agent.iterations": Histogram,
  "agent.tool_calls": Counter,
  "agent.tokens.input": Counter,
  "agent.tokens.output": Counter,

  // Queue health
  "queue.pending": Gauge,
  "queue.processing": Gauge,
};
```

**Grafana dashboard query examples:**

```promql
# Job processing rate
rate(worker_jobs_completed_total[5m])

# Average job duration
histogram_quantile(0.95, rate(worker_jobs_duration_bucket[5m]))

# Queue depth
queue_pending
```

## Roadmap

- [ ] Computer use integration for UI testing
- [ ] Git operations as built-in tools
- [ ] Diff preview before apply
- [ ] Cost tracking and limits
- [x] Streaming progress updates (SSE)
- [x] Bidirectional streaming (WebSocket)
- [x] Deployment architecture documentation
- [ ] Multi-file atomic operations
- [ ] KEDA autoscaling integration
