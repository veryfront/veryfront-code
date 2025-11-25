# Durable Workflows Example

This example demonstrates Veryfront's durable workflow system with:

- **DAG-based execution** - Complex dependency graphs with parallel execution
- **Human-in-the-loop** - Approval gates that pause workflows
- **Checkpointing** - Automatic state persistence for recovery
- **Multiple backends** - In-memory for dev, Redis for production

## Workflows Included

### 1. Content Pipeline

A multi-step content generation workflow:

```
research → [write, images] (parallel) → review (approval) → publish
```

### 2. Data Processing Pipeline

A DAG-based data transformation workflow:

```
fetch → validate → [transform, aggregate, enrich] → merge → export
```

## Quick Start

```bash
# Start API server
deno task dev
```

## API Endpoints

### Start a Workflow

```bash
curl -X POST http://localhost:3000/api/workflows/content-pipeline/start \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "topic": "AI Safety",
      "audience": "developers",
      "requiresApproval": true,
      "format": "blog"
    }
  }'
```

### Get Workflow Status

```bash
curl http://localhost:3000/api/workflows/runs/<runId>
```

### List Workflow Runs

```bash
curl http://localhost:3000/api/workflows/runs
```

### Handle Approvals

```bash
# Approve
curl -X POST http://localhost:3000/api/workflows/runs/<runId>/approvals/<approvalId> \
  -H "Content-Type: application/json" \
  -d '{"approved": true, "approver": "admin", "comment": "LGTM!"}'
```

## React Hooks

```tsx
import {
  useWorkflow,
  useWorkflowStart,
  useApproval,
  useWorkflowList,
} from 'veryfront/ai/workflow/react';

// Start a workflow
const { start, isStarting } = useWorkflowStart({
  workflowId: 'content-pipeline',
});

// Track workflow status
const { status, progress, pendingApprovals } = useWorkflow({ runId });

// Handle approval
const { approve, reject } = useApproval({ runId, approvalId });
```

## Workflow DSL

```typescript
import {
  workflow, step, parallel, branch, waitForApproval, dependsOn
} from 'veryfront/ai/workflow';

const myWorkflow = workflow({
  id: 'my-workflow',
  steps: ({ input }) => [
    step('research', { agent: 'researcher', input: input.topic }),
    parallel('generate', [
      step('write', { agent: 'writer' }),
      step('images', { tool: 'imageGen' }),
    ]),
    branch('review', {
      condition: () => input.needsApproval,
      then: [waitForApproval('human-review', { timeout: '24h' })],
    }),
    step('publish', { agent: 'publisher' }),
  ],
});
```
