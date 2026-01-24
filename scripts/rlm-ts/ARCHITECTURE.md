# RLM API Architecture

This document describes how to deploy RLM as a production API using durable execution, serverless patterns, and batch API cost optimization.

## Overview

RLM integrates with veryfront's existing workflow system to provide:

1. **Durable Execution** - Iterations survive crashes, can resume from checkpoints
2. **Serverless Deployment** - Works with Inngest, Cloudflare Workers, Vercel
3. **Batch API Integration** - 50% cost savings with OpenAI/Anthropic Batch APIs
4. **Multiple Backends** - Memory, Redis, Temporal, Inngest, Cloudflare

## Architecture Options

### Option 1: Durable Workflow (Recommended)

Use veryfront's workflow system with RLM as workflow steps.

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Request                          │
│                    POST /api/rlm/completion                     │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Veryfront Workflow                         │
│  ┌───────────┐    ┌───────────┐    ┌───────────┐               │
│  │   Init    │───▶│   Loop    │───▶│ Finalize  │               │
│  │  (step)   │    │(iterations)│    │  (step)   │               │
│  └───────────┘    └─────┬─────┘    └───────────┘               │
│                         │                                       │
│                         ▼                                       │
│                  ┌────────────┐                                 │
│                  │ Checkpoint │  (Survives crashes)             │
│                  │  (Redis)   │                                 │
│                  └────────────┘                                 │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Backend (Configurable)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │  Memory  │  │  Redis   │  │ Temporal │  │ Inngest  │        │
│  │  (dev)   │  │  (prod)  │  │(enterprise)│ │(serverless)│      │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

**Implementation:**

```typescript
// workflows/rlm-processor.ts
import { workflow, step, loop } from "veryfront/workflow";
import { z } from "zod";
import {
  initializeState,
  executeIteration,
  buildResult,
} from "rlm-ts/workflow";

export default workflow({
  id: "rlm-processor",
  description: "Durable RLM execution with checkpointing",

  inputSchema: z.object({
    query: z.string(),
    context: z.any().optional(),
    config: z.object({
      model: z.string().default("gpt-4o"),
      maxIterations: z.number().default(10),
    }),
  }),

  timeout: "5m",

  steps: ({ input }) => [
    // Initialize RLM state
    step("init", {
      tool: "rlm-init",
      input: { query: input.query, context: input.context },
      checkpoint: true, // Save state after init
    }),

    // Iterate until completion
    loop("iterations", {
      while: (ctx) => ctx["iterate"]?.continue !== false,
      maxIterations: input.config.maxIterations,
      steps: [
        step("iterate", {
          tool: "rlm-iterate",
          input: (ctx) => ({
            state: ctx["init"] || ctx["iterate"]?.state,
          }),
          checkpoint: true, // Checkpoint each iteration
          retry: { maxAttempts: 3, backoff: "exponential" },
        }),
      ],
    }),

    // Build final result
    step("finalize", {
      tool: "rlm-finalize",
      input: (ctx) => ctx["iterate"]?.state,
    }),
  ],

  onComplete: async (result, context) => {
    console.log("RLM completed:", result.finalAnswer);
  },
});
```

**Pros:**
- Survives crashes, can resume from any checkpoint
- Works with existing veryfront infrastructure
- Supports human-in-the-loop approvals
- Full observability via workflow dashboard

**Cons:**
- Requires workflow backend (Redis for production)
- Slight latency overhead from checkpointing

---

### Option 2: Serverless with Inngest

Fully serverless deployment with automatic scaling.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Inngest Event                                │
│              rlm/job.submitted { query, context }               │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Inngest Function                             │
│                                                                 │
│   async ({ event, step }) => {                                  │
│     const state = await step.run("init", () =>                  │
│       initializeState(event.data)                               │
│     );                                                          │
│                                                                 │
│     while (state.continue) {                                    │
│       state = await step.run(`iter-${i}`, () =>                 │
│         executeIteration(state)                                 │
│       );                                                        │
│       await step.sleep("rate-limit", "100ms");                  │
│     }                                                           │
│                                                                 │
│     return buildResult(state);                                  │
│   }                                                             │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│            Webhook / Return Result                              │
└─────────────────────────────────────────────────────────────────┘
```

**Implementation:**

```typescript
// inngest/rlm-function.ts
import { Inngest } from "inngest";
import {
  initializeState,
  executeIteration,
  buildResult,
} from "rlm-ts/workflow";

const inngest = new Inngest({ id: "rlm" });

export const rlmProcessor = inngest.createFunction(
  {
    id: "rlm-processor",
    retries: 3,
    concurrency: { limit: 10 },
  },
  { event: "rlm/job.submitted" },
  async ({ event, step }) => {
    // Each step is durable - survives function restarts
    let state = await step.run("initialize", () =>
      initializeState({
        jobId: event.data.jobId,
        query: event.data.query,
        context: event.data.context,
        config: event.data.config,
      })
    );

    // Iterate with durable steps
    let iteration = 0;
    while (iteration < 10) {
      const result = await step.run(`iteration-${iteration}`, () =>
        executeIteration(state, event.data.config)
      );

      state = result.state;

      if (!result.continue) break;
      iteration++;

      // Rate limiting between iterations
      await step.sleep("rate-limit", "100ms");
    }

    // Final result
    const result = await step.run("finalize", () =>
      buildResult(state, event.data.config)
    );

    // Optional: Send webhook
    if (event.data.webhookUrl) {
      await step.run("webhook", () =>
        fetch(event.data.webhookUrl, {
          method: "POST",
          body: JSON.stringify(result),
        })
      );
    }

    return result;
  }
);
```

**Pros:**
- True serverless (scales to zero, pay per use)
- Built-in retry, rate limiting, concurrency control
- No infrastructure to manage
- Works on Vercel, Cloudflare, etc.

**Cons:**
- Requires Inngest account/setup
- Async only (no sync API)
- Cold start latency

---

### Option 3: Batch API Integration

For cost optimization on high-volume, non-urgent workloads.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Batch Submission                             │
│              POST /api/rlm/batch { jobs: [...] }                │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Batch Processor                              │
│                                                                 │
│   1. Convert jobs to JSONL                                      │
│   2. Upload to OpenAI/Anthropic                                 │
│   3. Store batch ID in database                                 │
│   4. Return batch ID to client                                  │
└─────────────────────────────────────────────────────────────────┘
                                │
                     (24h async processing)
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Webhook Handler                              │
│              POST /api/rlm/batch/webhook                        │
│                                                                 │
│   1. Receive completion notification                            │
│   2. Download results                                           │
│   3. Process each result through RLM iterations                 │
│   4. Store final results                                        │
│   5. Notify clients (webhook/email)                             │
└─────────────────────────────────────────────────────────────────┘
```

**Implementation:**

```typescript
// api/rlm/batch.ts
import { prepareBatchJobs, batchJobsToJsonl } from "rlm-ts/workflow";

// Submit batch
export async function submitBatch(jobs: RLMJob[]) {
  // Prepare JSONL
  const batchJobs = prepareBatchJobs(jobs, { model: "gpt-4o" });
  const jsonl = batchJobsToJsonl(batchJobs);

  // Upload file to OpenAI
  const file = await openai.files.create({
    file: new Blob([jsonl]),
    purpose: "batch",
  });

  // Create batch
  const batch = await openai.batches.create({
    input_file_id: file.id,
    endpoint: "/v1/chat/completions",
    completion_window: "24h",
    metadata: { jobs: jobs.map((j) => j.jobId) },
  });

  // Store batch info in database
  await db.batches.create({
    batchId: batch.id,
    status: "processing",
    jobs: jobs.map((j) => j.jobId),
    createdAt: new Date(),
  });

  return { batchId: batch.id, estimatedCompletion: "24h" };
}

// Webhook handler (called by OpenAI when batch completes)
export async function handleBatchWebhook(batchId: string) {
  const batch = await openai.batches.retrieve(batchId);

  if (batch.status === "completed") {
    // Download results
    const results = await openai.files.content(batch.output_file_id);

    // Process each result
    for (const line of results.split("\n")) {
      const result = JSON.parse(line);
      const jobId = result.custom_id;

      // Continue RLM iterations if needed
      // (batch only does first iteration, may need more)
      await continueRLMIfNeeded(jobId, result.response);
    }
  }
}
```

**Pricing Comparison:**

| Mode | Input (1M tokens) | Output (1M tokens) | Total |
|------|-------------------|--------------------| ------|
| Sync API | $2.50 | $10.00 | $12.50 |
| Batch API | $1.25 | $5.00 | **$6.25 (50% off)** |

**Pros:**
- 50% cost reduction
- Good for high-volume processing
- No rate limit concerns

**Cons:**
- 24-hour completion window
- Not suitable for real-time
- Multi-iteration complexity

---

### Option 4: Hybrid Mode (Recommended for Production)

Combine approaches based on request characteristics.

```
┌─────────────────────────────────────────────────────────────────┐
│                      Request Router                             │
│                                                                 │
│   if (urgent || small_context) {                                │
│     → Sync Workflow (immediate response)                        │
│   } else if (large_batch) {                                     │
│     → Batch API (50% cost savings)                              │
│   } else {                                                      │
│     → Async Workflow (webhook on completion)                    │
│   }                                                             │
└─────────────────────────────────────────────────────────────────┘
```

**Implementation:**

```typescript
// api/rlm/completion.ts
export async function handleRLMRequest(req: Request) {
  const { query, context, options } = await req.json();

  const contextSize = estimateTokens(context);
  const isUrgent = options?.urgent ?? false;
  const isBatch = options?.batch ?? false;

  // Route based on characteristics
  if (isBatch) {
    // Queue for batch processing
    return queueForBatch({ query, context, options });
  }

  if (isUrgent || contextSize < 10000) {
    // Sync execution (wait for result)
    const result = await executeSyncRLM({ query, context, options });
    return Response.json(result);
  }

  // Async execution (return job ID)
  const { jobId } = await queueForAsync({ query, context, options });
  return Response.json({
    jobId,
    status: "processing",
    statusUrl: `/api/rlm/jobs/${jobId}`,
  });
}
```

---

## Deployment Configurations

### Development

```typescript
// veryfront.config.ts
export default {
  workflow: {
    backend: "memory", // No external deps
  },
};
```

### Production (Kubernetes)

```typescript
// veryfront.config.ts
export default {
  workflow: {
    backend: "redis",
    redis: {
      url: process.env.REDIS_URL,
      prefix: "rlm:",
    },
  },
};
```

### Serverless (Vercel/Cloudflare)

```typescript
// veryfront.config.ts
export default {
  workflow: {
    backend: "inngest",
    inngest: {
      eventKey: process.env.INNGEST_EVENT_KEY,
      signingKey: process.env.INNGEST_SIGNING_KEY,
    },
  },
};
```

### Enterprise (Temporal)

```typescript
// veryfront.config.ts
export default {
  workflow: {
    backend: "temporal",
    temporal: {
      address: process.env.TEMPORAL_ADDRESS,
      namespace: "rlm",
      taskQueue: "rlm-tasks",
    },
  },
};
```

---

## API Endpoints

### Sync Completion

```http
POST /api/rlm/completion
Content-Type: application/json

{
  "query": "What is the sum of the first 100 prime numbers?",
  "context": { "data": [...] },
  "options": {
    "model": "gpt-4o",
    "maxIterations": 10,
    "timeout": "60s"
  }
}

Response: {
  "success": true,
  "finalAnswer": "The sum is 24133",
  "iterations": [...],
  "usage": { "totalTokens": 1234 }
}
```

### Async Job

```http
POST /api/rlm/jobs
Content-Type: application/json

{
  "query": "Analyze this large dataset...",
  "context": { "data": [...large...] },
  "webhookUrl": "https://my-app.com/webhooks/rlm"
}

Response: {
  "jobId": "rlm_abc123",
  "status": "processing",
  "statusUrl": "/api/rlm/jobs/rlm_abc123"
}
```

### Batch Submission

```http
POST /api/rlm/batch
Content-Type: application/json

{
  "jobs": [
    { "id": "job1", "query": "Query 1", "context": {...} },
    { "id": "job2", "query": "Query 2", "context": {...} },
    ...
  ],
  "webhookUrl": "https://my-app.com/webhooks/batch"
}

Response: {
  "batchId": "batch_xyz789",
  "estimatedCompletion": "24h",
  "jobCount": 100
}
```

---

## Monitoring & Observability

The RLM workflow integrates with veryfront's observability stack:

- **Grafana Dashboards** - Iteration counts, latency, token usage
- **Loki Logs** - Per-iteration logs with trace IDs
- **Tempo Traces** - End-to-end request tracing

```typescript
// Automatic trace propagation
const result = await rlm.completion({
  query: "...",
  traceId: req.headers.get("x-trace-id"),
});
```

---

## Cost Optimization Tips

1. **Use Batch API for bulk processing** - 50% cost reduction
2. **Set appropriate maxIterations** - Most queries complete in 3-5 iterations
3. **Cache common queries** - Use Redis/CDN for repeated questions
4. **Choose the right model** - Use `gpt-4o-mini` for simple tasks
5. **Implement early termination** - Detect when answer is found

---

## References

- [Temporal](https://temporal.io/) - Enterprise durable execution
- [Inngest](https://www.inngest.com/) - Serverless durable functions
- [Trigger.dev](https://trigger.dev/) - Background jobs for TypeScript
- [OpenAI Batch API](https://platform.openai.com/docs/guides/batch)
- [Anthropic Batch API](https://docs.anthropic.com/en/docs/build-with-claude/batch-processing)
