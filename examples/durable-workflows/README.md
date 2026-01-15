# Durable Workflows Example

This example demonstrates Veryfront's durable workflow system with:

- **DAG-based execution** - Complex dependency graphs with parallel execution
- **Human-in-the-loop** - Approval gates that pause workflows
- **Checkpointing** - Automatic state persistence for recovery
- **Auto-discovery** - Workflows, agents, and tools are auto-registered from `ai/` directory

## Directory Structure

```
examples/durable-workflows/
├── ai/
│   ├── agents/
│   │   ├── researcher.ts    # Research assistant agent
│   │   ├── writer.ts        # Content writer agent
│   │   └── publisher.ts     # Content publisher agent
│   ├── tools/
│   │   ├── image-generator.ts
│   │   ├── auto-approver.ts
│   │   ├── data-fetcher.ts
│   │   ├── data-validator.ts
│   │   ├── data-transformer.ts
│   │   ├── data-aggregator.ts
│   │   ├── data-enricher.ts
│   │   ├── data-merger.ts
│   │   └── data-exporter.ts
│   └── workflows/
│       ├── content-pipeline.ts
│       └── data-processing.ts
├── pages/
│   └── index.tsx
├── veryfront.config.ts
└── README.md
```

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
# From the renderer root directory
cd examples/durable-workflows
deno task dev
```

This starts the dev server at `http://localhost:3002`.

## Dev Dashboard

Access the dev dashboard at `http://localhost:3002/_dev` to:

- **AI Tab**: View and test registered tools, agents, resources, prompts, and workflows
- **Server Tab**: Inspect handlers and middleware
- **Files Tab**: Browse project files
- **Debug Tab**: View runtime context

### Testing Tools

1. Navigate to `/_dev` → AI → Tools
2. Select a tool from the sidebar
3. The input schema is auto-populated with example values
4. Click "Run" to execute the tool

### Viewing Workflows

1. Navigate to `/_dev` → AI → Workflows
2. View workflow definitions and DAG structure

## Workflow DSL

```typescript
import {
  workflow, step, parallel, branch, waitForApproval
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

## Configuration

The example uses local filesystem mode:

```typescript
// veryfront.config.ts
export default {
  fs: { type: "local" },
  dev: { port: 3002, host: "localhost", hmr: true },
};
```
