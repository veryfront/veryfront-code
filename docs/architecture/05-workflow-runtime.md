# Workflow runtime

This page describes workflow definition and execution. It does not cover agent
streaming, background task definitions, or job queue infrastructure.

## Responsibility

The workflow runtime defines DAG steps, validates dependencies, executes steps,
tracks approvals, and persists workflow run state through configured backends.

Primary source areas:

- [`src/workflow/dsl/`](../../src/workflow/dsl/)
- [`src/workflow/executor/`](../../src/workflow/executor/)
- [`src/workflow/runtime/`](../../src/workflow/runtime/)
- [`src/workflow/backends/`](../../src/workflow/backends/)
- [`src/workflow/worker/`](../../src/workflow/worker/)
- [`src/workflow/api/`](../../src/workflow/api/)

## Runtime flow

```mermaid
flowchart TD
  definition[Workflow definition] --> graph[Build step graph]
  graph --> validate[Validate dependencies and graph shape]
  validate --> ready{Ready steps}
  ready --> agentStep[Agent step]
  ready --> toolStep[Tool step]
  ready --> waitStep[Wait or approval step]
  ready --> parallel[Parallel, map, or loop group]

  agentStep --> checkpoint[Checkpoint and backend state]
  toolStep --> checkpoint
  waitStep --> checkpoint
  parallel --> ready
  checkpoint --> complete{More ready steps?}
  complete -->|yes| ready
  complete -->|no| result[Workflow result]

  worker[Worker profile] --> ready
```

1. Workflow DSL helpers build step graphs, branches, loops, maps, parallel
   groups, waits, and sub-workflows.
2. Validation checks graph shape and step dependencies before execution.
3. The DAG executor evaluates ready steps and delegates individual step work to
   step executors.
4. Checkpoint and backend code stores run progress, approvals, and recovery
   state.
5. Worker entrypoints run workflow jobs in process, subprocess, or Kubernetes
   execution profiles.

## Boundaries

- A workflow is a step graph. It is not a job, task, cron job, or agent run.
- Workflow API clients expose workflow run operations. They do not own step
  execution semantics.
- Agent steps may call the agent runtime, but workflow state remains owned by the
  workflow runtime.

## Change checks

- Add tests for graph validation when changing the DSL.
- Add executor tests when changing DAG ordering, approvals, retry behavior, or
  checkpointing.
- Keep workflow terminology aligned with `docs/guides/workflows.md`.
