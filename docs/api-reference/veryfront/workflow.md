---
title: "veryfront/workflow"
description: "DAG-based agentic workflows with human-in-the-loop support."
order: 45
---

## Import

```ts
import {
  branch,
  createWorkflowClient,
  parallel,
  step,
  waitForApproval,
  workflow,
} from "veryfront/workflow";
```

## Examples

### Simple sequential workflow

```typescript
import { step, workflow } from "veryfront/workflow";

const pipeline = workflow({
  id: "summarize",
  steps: () => [
    step("fetch", { tool: "webScraper" }),
    step("summarize", { agent: "writer" }),
  ],
});
```

### Parallel steps and human-in-the-loop

```typescript
import { branch, parallel, step, waitForApproval, workflow } from "veryfront/workflow";

const contentPipeline = workflow({
  id: "content-pipeline",
  steps: ({ input }) => [
    step("research", { agent: "researcher" }),
    parallel("generate", [
      step("write", { agent: "writer" }),
      step("images", { tool: "imageGenerator" }),
    ]),
    branch("review", {
      condition: () => input.requiresApproval,
      then: [waitForApproval("human-review", { timeout: "24h" })],
    }),
    step("publish", { agent: "publisher" }),
  ],
});
```

## API

### `workflow(options)`

Create a workflow definition.

| Property                   | Type                                                                                                  | Description                                                           | Source                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `id`                       | `string`                                                                                              | Unique workflow identifier                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts) |
| `description?`             | `string`                                                                                              | Human-readable description                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts) |
| `version?`                 | `string`                                                                                              | Semantic version string                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts) |
| `inputSchema?`             | <code>Schema&lt;TInput&gt;</code>                                                                     | Zod schema for workflow input validation                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts) |
| `outputSchema?`            | <code>Schema&lt;TOutput&gt;</code>                                                                    | Zod schema for workflow output validation                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts) |
| `integrationRequirements?` | `ScheduleIntegrationRequirementConfig[]`                                                              | Explicit integration scopes and resources required by scheduled runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts) |
| `retry?`                   | `RetryConfig`                                                                                         | Retry configuration for failed steps                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts) |
| `timeout?`                 | `string \| number`                                                                                    | Max execution time (ms)                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts) |
| `introspect?`              | `boolean`                                                                                             | Enable runtime introspection for debugging                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts) |
| `steps`                    | <code>WorkflowNode[] &#124; ((context: StepBuilderContext&lt;TInput&gt;) =&gt; WorkflowNode[])</code> | Workflow step definitions                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts) |
| `onError?`                 | <code>(error: Error, context: WorkflowContext) =&gt; void &#124; Promise&lt;void&gt;</code>           | Error handler called when a step fails                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts) |
| `onComplete?`              | <code>(result: TOutput, context: WorkflowContext) =&gt; void &#124; Promise&lt;void&gt;</code>        | Callback fired after workflow completes                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts) |

**Returns:** <code>Workflow&lt;TInput, TOutput&gt;</code>

## Type Reference

### `StepOptions`

Options accepted by step.

| Property      | Type                                                                                                       | Description                                              | Source                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `agent?`      | `string \| Agent`                                                                                          | Agent to run (by ID or instance)                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts) |
| `tool?`       | `string \| Tool`                                                                                           | Tool to execute (by ID or instance)                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts) |
| `input?`      | <code>string &#124; Record&lt;string, unknown&gt; &#124; ((context: WorkflowContext) =&gt; unknown)</code> | Step input: static value or function of workflow context | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts) |
| `checkpoint?` | `boolean`                                                                                                  | Persist state after this step                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts) |
| `retry?`      | `RetryConfig`                                                                                              | Retry configuration for this step                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts) |
| `timeout?`    | `string \| number`                                                                                         | Step timeout (ms)                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts) |
| `skip?`       | <code>(context: WorkflowContext) =&gt; boolean &#124; Promise&lt;boolean&gt;</code>                        | Predicate: skip this step if returns true                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts) |

### `BranchOptions`

Options accepted by branch.

| Property      | Type                                                                                | Description                          | Source                                                                                     |
| ------------- | ----------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `condition`   | <code>(context: WorkflowContext) =&gt; boolean &#124; Promise&lt;boolean&gt;</code> | Branch predicate function            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts) |
| `then`        | `WorkflowNode[]`                                                                    | Steps when condition is true         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts) |
| `else?`       | `WorkflowNode[]`                                                                    | Steps when condition is false        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts) |
| `checkpoint?` | `boolean`                                                                           | Persist state after this node        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts) |
| `retry?`      | `RetryConfig`                                                                       | Retry configuration                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts) |
| `timeout?`    | `string \| number`                                                                  | Node timeout (ms or duration string) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts) |
| `skip?`       | <code>(context: WorkflowContext) =&gt; boolean &#124; Promise&lt;boolean&gt;</code> | Predicate: skip if returns true      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts) |

### `ParallelOptions`

Options accepted by parallel.

| Property      | Type                                                                                | Description                                             | Source                                                                                       |
| ------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `strategy?`   | `"all" \| "race" \| "allSettled"`                                                   | Completion strategy (`"all"`, `"race"`, `"allSettled"`) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts) |
| `checkpoint?` | `boolean`                                                                           | Persist state after this node                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts) |
| `retry?`      | `RetryConfig`                                                                       | Retry configuration                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts) |
| `timeout?`    | `string \| number`                                                                  | Node timeout (ms or duration string)                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts) |
| `skip?`       | <code>(context: WorkflowContext) =&gt; boolean &#124; Promise&lt;boolean&gt;</code> | Predicate: skip if returns true                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts) |

## Exports

### Functions

| Name                             | Description                                                                                         | Source                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `agentStep`                      | Create a workflow step that runs an agent.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts)                 |
| `branch`                         | Create a conditional branch node.                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts)               |
| `createWorkflowClient`           | Create workflow client.                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api/workflow-client.ts)      |
| `createWorkflowHandler`          | Build the HTTP routes the workflow hooks call.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/http/handler.ts)             |
| `dag`                            | Create a directed workflow graph.                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts)             |
| `delay`                          | Create a simple delay/sleep node.                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts)                 |
| `dependsOn`                      | Declare workflow step dependencies.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts)             |
| `deriveRunEvents`                | Events describing how a run got from `previous` to `next`.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts)                   |
| `doWhile`                        | Create a do-while workflow loop.                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/loop.ts)                 |
| `generateId`                     | Generate a unique workflow ID                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts)                    |
| `getAllWorkflowIds`              | List registered workflow IDs for the current project scope.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts)                 |
| `getWorkflow`                    | Get metadata for a registered workflow by ID.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts)                 |
| `getWorkflowTenant`              | Get the current workflow tenant context. Returns undefined if not executing within a workflow step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/executor/step-executor.ts)   |
| `hasEventWaitSupport`            | Check whether durable event waits are available.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts)           |
| `hasRunObservationSupport`       | Check whether atomic run observation is available.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts)           |
| `hasTerminalRunRetentionSupport` | Check whether fenced terminal-run deletion is available.                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts)           |
| `hasWorkerSupport`               | Check whether worker support is present.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts)           |
| `isTerminalRunStatus`            | Whether a run in this status can still produce events.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts)                   |
| `loop`                           | Create a loop workflow step.                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/loop.ts)                 |
| `map`                            | Create a mapped workflow step.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/map.ts)                  |
| `parallel`                       | Create a parallel node for concurrent execution of multiple steps.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts)             |
| `parseDuration`                  | Parse duration string to milliseconds                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts)                    |
| `reapTerminalRuns`               | Delete one bounded batch of runs that still match an old terminal snapshot.                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/retention.ts)                |
| `sequence`                       | Create a sequential workflow definition.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts)             |
| `snapshotRun`                    | Reduce a run to the state `deriveRunEvents` compares.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts)                   |
| `step`                           | Create a workflow step definition.                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts)                 |
| `subWorkflow`                    | Create a sub-workflow node for nested execution.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/sub-workflow.ts)         |
| `times`                          | Create a fixed-count workflow loop.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/loop.ts)                 |
| `toolStep`                       | Create a workflow step that runs a tool.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts)                 |
| `unless`                         | Create a branch that only executes if condition is false.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts)               |
| `useApproval`                    | Manage workflow approval interactions.                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-approval.ts)       |
| `useWorkflow`                    | React hook for workflow.                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow.ts)       |
| `useWorkflowList`                | List and filter workflow runs.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-list.ts)  |
| `useWorkflowStart`               | React hook for workflow start.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-start.ts) |
| `waitForApproval`                | Create a wait-for-approval node. Pauses until human approves/rejects.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts)                 |
| `waitForEvent`                   | Create a wait-for-event node. Pauses until external event is received.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts)                 |
| `when`                           | Create a branch that only executes if condition is true (no else).                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts)               |
| `workflow`                       | Create a workflow definition.                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts)             |

### Classes

| Name               | Description                | Source                                                                                                     |
| ------------------ | -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `MemoryBackend`    | Implement memory backend.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/memory.ts)            |
| `RedisBackend`     | Implement redis backend.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/redis/index.ts)       |
| `WorkflowClient`   | Implement workflow client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api/workflow-client.ts)        |
| `WorkflowExecutor` | Workflow Executor class    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/executor/workflow-executor.ts) |

### Types

| Name                              | Description                                                                                                                                                                                                                                                                                                                                                                                                 | Source                                                                                                     |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `BackendConfig`                   | Configuration used by backend.                                                                                                                                                                                                                                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts)             |
| `BranchOptions`                   | Options accepted by branch.                                                                                                                                                                                                                                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts)                 |
| `CapturedTenantContext`           | Captured tenant context for multi-tenant workflow execution. Allows tools and framework utilities to access the current tenant without explicit parameter passing.                                                                                                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts)                      |
| `LoopOptions`                     | Options accepted by loop.                                                                                                                                                                                                                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/loop.ts)                   |
| `MapOptions`                      | Options accepted by map.                                                                                                                                                                                                                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/map.ts)                    |
| `NodeInfo`                        | Metadata for one node in a registered workflow graph.                                                                                                                                                                                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts)                   |
| `ParallelOptions`                 | Options accepted by parallel.                                                                                                                                                                                                                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts)               |
| `PendingEventWait`                | Durable record of a run parked on a `waitForEvent` or `delay` node.                                                                                                                                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts)                      |
| `PublishEventOutcome`             | What `publishEvent` did with an event.                                                                                                                                                                                                                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/runtime/event-wait-manager.ts) |
| `RedisAdapter`                    | Standardized Redis Adapter Interface Normalizes differences between Deno and Node Redis clients                                                                                                                                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/redis/interface.ts)   |
| `RedisBackendConfig`              | Redis backend configuration                                                                                                                                                                                                                                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/redis/types.ts)       |
| `RunEventEnvelope`                | One event durably buffered in a run's mailbox until a wait consumes it.                                                                                                                                                                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts)             |
| `RunEventSnapshot`                | The slice of a run this module diffs against.                                                                                                                                                                                                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts)                     |
| `StepOptions`                     | Options accepted by step.                                                                                                                                                                                                                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts)                   |
| `SubWorkflowOptions`              | Options accepted by sub workflow.                                                                                                                                                                                                                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/sub-workflow.ts)           |
| `TerminalRunRetentionCandidate`   | Exact terminal snapshot a backend must still observe before deleting a run.                                                                                                                                                                                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts)             |
| `TerminalRunRetentionOptions`     | Options for one bounded terminal-run retention sweep.                                                                                                                                                                                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/retention.ts)                  |
| `TerminalRunRetentionResult`      | Outcome of one terminal-run retention sweep.                                                                                                                                                                                                                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/retention.ts)                  |
| `TerminalWorkflowStatus`          | Workflow status whose execution has ended.                                                                                                                                                                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts)             |
| `UseApprovalOptions`              | Options accepted by use approval.                                                                                                                                                                                                                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-approval.ts)         |
| `UseApprovalResult`               | Result returned from use approval.                                                                                                                                                                                                                                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-approval.ts)         |
| `UseWorkflowListOptions`          | Options accepted by use workflow list.                                                                                                                                                                                                                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-list.ts)    |
| `UseWorkflowListResult`           | Result returned from use workflow list.                                                                                                                                                                                                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-list.ts)    |
| `UseWorkflowOptions`              | Options accepted by use workflow.                                                                                                                                                                                                                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow.ts)         |
| `UseWorkflowResult`               | Result returned from use workflow.                                                                                                                                                                                                                                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow.ts)         |
| `UseWorkflowStartOptions`         | Options accepted by use workflow start.                                                                                                                                                                                                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-start.ts)   |
| `UseWorkflowStartResult`          | Result returned from use workflow start.                                                                                                                                                                                                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-start.ts)   |
| `WaitForApprovalOptions`          | Options accepted by wait for approval.                                                                                                                                                                                                                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts)                   |
| `WaitForEventOptions`             | Options accepted by wait for event.                                                                                                                                                                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts)                   |
| `WithTerminalRunRetentionSupport` | Workflow backend with atomic terminal-run retention support.                                                                                                                                                                                                                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts)             |
| `Workflow`                        | Workflow instance                                                                                                                                                                                                                                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts)                      |
| `WorkflowApprovalPendingEvent`    | A pending approval was persisted; the run is parked until it is decided.                                                                                                                                                                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts)                     |
| `WorkflowApprovalSummary`         | Data-minimized pending approval on the built-in HTTP surface.                                                                                                                                                                                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/http/run-summary.ts)           |
| `WorkflowBackend`                 | Public API contract for workflow backend.                                                                                                                                                                                                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts)             |
| `WorkflowClientConfig`            | Configuration used by workflow client.                                                                                                                                                                                                                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api/workflow-client.ts)        |
| `WorkflowContext`                 | Workflow context containing JSON-representable input and node outputs.                                                                                                                                                                                                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts)                      |
| `WorkflowDefinition`              | Workflow definition                                                                                                                                                                                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts)                      |
| `WorkflowExecutorConfig`          | Workflow executor configuration                                                                                                                                                                                                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/executor/workflow-executor.ts) |
| `WorkflowHandle`                  | Controller for a running workflow.                                                                                                                                                                                                                                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/executor/workflow-executor.ts) |
| `WorkflowHandlerOptions`          | Options for `createWorkflowHandler`.                                                                                                                                                                                                                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/http/handler.ts)               |
| `WorkflowHandlers`                | Route handlers to re-export from a catch-all route module.                                                                                                                                                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/http/handler.ts)               |
| `WorkflowMetadata`                | Public metadata captured for a registered workflow.                                                                                                                                                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts)                   |
| `WorkflowNode`                    | Workflow node                                                                                                                                                                                                                                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts)                      |
| `WorkflowNodeConfig`              | Union of all workflow node configurations                                                                                                                                                                                                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts)                      |
| `WorkflowNodeStateSummary`        | Data-minimized state for one workflow node on the built-in HTTP surface.                                                                                                                                                                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/http/run-summary.ts)           |
| `WorkflowOptions`                 | Options accepted by workflow.                                                                                                                                                                                                                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts)               |
| `WorkflowRun`                     | Workflow run state                                                                                                                                                                                                                                                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts)                      |
| `WorkflowRunEvent`                | A persisted workflow transition suitable for streaming to run observers.                                                                                                                                                                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts)                     |
| `WorkflowRunEventObservation`     | Subscriber-local event stream derived from one atomic backend observation.                                                                                                                                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts)                     |
| `WorkflowRunEventsResult`         | Supported observation stream or an explicit unsupported-backend result.                                                                                                                                                                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api/workflow-client.ts)        |
| `WorkflowRunObservation`          | Atomic initial snapshot and ordered changes for one workflow run.                                                                                                                                                                                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts)             |
| `WorkflowRunObservedState`        | Minimal persisted run state used to derive public workflow events.                                                                                                                                                                                                                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts)             |
| `WorkflowRunStatusEvent`          | The run as a whole moved to a new status.                                                                                                                                                                                                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts)                     |
| `WorkflowRunSummary`              | Data-minimized workflow run returned by the built-in HTTP and React surfaces.                                                                                                                                                                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/http/run-summary.ts)           |
| `WorkflowRunUpdate`               | Mutable run fields. On backends that declare `supportsRunPatchKeyMerge`, context and node-state entries merge by key atomically, so concurrent node outcomes cannot replace a sibling's persisted entry. Backends without that declaration replace the maps wholesale (the historical contract), so callers must send complete maps unless merge support was verified through `hasRunPatchKeyMergeSupport`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts)             |
| `WorkflowStatus`                  | Public API contract for workflow status.                                                                                                                                                                                                                                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/schemas/workflow.schema.ts)    |
| `WorkflowStepCompletedEvent`      | A step finished successfully.                                                                                                                                                                                                                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts)                     |
| `WorkflowStepFailedEvent`         | A step failed. `error` is the persisted message, absent when none was set.                                                                                                                                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts)                     |
| `WorkflowStepSkippedEvent`        | A step was skipped, typically by an unmet branch condition.                                                                                                                                                                                                                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts)                     |
| `WorkflowStepStartedEvent`        | A step began executing.                                                                                                                                                                                                                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts)                     |

### Constants

| Name               | Description                                                    | Source                                                                                   |
| ------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `api`              | Context-aware API that automatically uses the current tenant.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api.ts)      |
| `workflowRegistry` | Project-scoped registry for workflow metadata and definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/workflow/blob`

Provider-neutral blob storage contracts and built-in first-party storage.

```ts
import { assertSafeBlobId, BlobStorageContractName, isSafeBlobId } from "veryfront/workflow/blob";
```

#### Components

| Name                      | Description                                                                     | Source                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `BlobStorageContractName` | Extension contract name for an explicitly selected blob-storage implementation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/types.ts) |

#### Functions

| Name               | Description                                                               | Source                                                                                       |
| ------------------ | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `assertSafeBlobId` | Validate an identifier before any blob backend constructs a storage path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/blob-id.ts) |
| `isSafeBlobId`     | Return whether a runtime value is a framework-safe blob identifier.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/blob-id.ts) |

#### Classes

| Name                        | Description | Source                                                                                                       |
| --------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| `LocalBlobStorage`          |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/local-storage.ts)           |
| `VeryfrontCloudBlobStorage` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/veryfront-cloud-storage.ts) |

#### Types

| Name                              | Description        | Source                                                                                                       |
| --------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `BlobRef`                         | Blob Storage Types | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/types.ts)                   |
| `BlobStorage`                     |                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/types.ts)                   |
| `StoreBlobOptions`                |                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/types.ts)                   |
| `VeryfrontCloudBlobStorageConfig` |                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/veryfront-cloud-storage.ts) |

### `veryfront/workflow/claude-code`

Claude Agent SDK Integration Provides Claude Code agentic capabilities within Veryfront workflows. Uses your local Claude Code installation - no separate API key needed.

```ts
import {
  createAgent,
  createClaudeCodeTool,
  createEventPublisher,
} from "veryfront/workflow/claude-code";
```

#### Functions

| Name                     | Description                                                 | Source                                                                                                          |
| ------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `createAgent`            | Create a reusable agent function with preset configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/agent.ts)               |
| `createClaudeCodeTool`   | Create a customized Claude Code tool                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts)                |
| `createEventPublisher`   | Create an event publisher based on environment              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts)     |
| `createWebSocketHandler` | Create a WebSocket handler for HTTP upgrade requests.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts) |
| `createWorkspaceSync`    | Create a workspace sync for a Claude Code run               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts)      |
| `executeAgent`           | Execute a task using the Claude Agent SDK.                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/agent.ts)               |
| `withWorkspace`          | Execute a function with a synchronized workspace            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts)      |

#### Classes

| Name                      | Description                                                                                                                                                                                                                                                   | Source                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `AgentController`         | Backwards-compatible single-connection controller.                                                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts) |
| `AgentControllerRegistry` | Retains one controller generation per run independently of transient publisher connections. Replacements synchronously retire the old publisher; only an exact publisher token can detach, and only an exact run token can terminally release the controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts) |
| `CallbackEventPublisher`  | Simple callback-based publisher Calls a function for each event                                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts)     |
| `MemoryEventPublisher`    | In-memory event publisher using EventTarget Useful for testing or single-process deployments                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts)     |
| `MultiEventPublisher`     | Publishes events to multiple publishers                                                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts)     |
| `RedisEventPublisher`     | Redis-backed publisher whose implementation is supplied by the Redis extension.                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts)     |
| `SSEEventPublisher`       | Server-Sent Events publisher Writes events directly to a ReadableStream controller                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts)     |
| `WebSocketPublisher`      | WebSocket-based bidirectional publisher                                                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts) |
| `WorkspaceSync`           | Workspace manager for Claude Code execution                                                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts)      |

#### Types

| Name                             | Description                                                       | Source                                                                                                               |
| -------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `AgentConfig`                    | Agent configuration                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/agent.ts)                    |
| `AgentControllerConfig`          | Run-scoped controller policy.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts)      |
| `AgentControllerHandle`          | Run-scoped command surface without transport lifecycle authority. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts)      |
| `AgentControllerRegistration`    | Opaque ownership token for one run publisher generation.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts)      |
| `AgentControllerRunRegistration` | Opaque ownership token for one run controller generation.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts)      |
| `ApprovalRequestEvent`           | Approval request event (sent to client when tool needs approval)  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `BidirectionalPublisher`         | Bidirectional publisher interface (WebSocket)                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `CancelCommand`                  | Cancel the running agent                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `CancelledEvent`                 | Cancelled event                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `ClaudeCodeEvent`                | Union of all event types                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `ClaudeCodeEventBase`            | Base event interface                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `ClaudeCodeEventHandler`         | Event subscriber callback                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `ClaudeCodeEventPublisher`       | Event publisher interface for streaming events                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `ClaudeCodeEventSubscriber`      | Event subscriber interface for receiving events                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `ClaudeCodeEventType`            | Event types for streaming Claude Code execution                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `ClaudeCodeMode`                 | Tool modes for Claude Code agent                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `ClaudeCodeResult`               | Final result from agent execution                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `ClaudeCodeToolInput`            | Input schema type for claude-code workflow tools                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `ClientCommand`                  | Union of all client commands                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `ClientCommandHandler`           |                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `ClientCommandType`              | Client command types for WebSocket communication                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `CompleteEvent`                  | Complete event (agent finished)                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `ErrorEvent`                     | Error event                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `FileChange`                     | File change tracking                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts)           |
| `InputCommand`                   | Send user input to the agent                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `InputRequestEvent`              | Input request event (sent to client when agent needs user input)  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `IterationCompleteEvent`         | Iteration complete event                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `IterationStartEvent`            | Iteration start event                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `PingCommand`                    | Keepalive ping                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `PongEvent`                      | Pong response to ping                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `RedisEventPublisherConfig`      | Redis Pub/Sub publisher configuration.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts) |
| `TextCompleteEvent`              | Text complete event                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `TextDeltaEvent`                 | Text delta event (streaming text chunk)                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `ThinkingCompleteEvent`          | Thinking complete event                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `ThinkingDeltaEvent`             | Thinking delta event                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `ThinkingStartEvent`             | Thinking start event (extended thinking)                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `ToolApprovalConfig`             | Tool approval configuration                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `ToolCallCompleteEvent`          | Tool call complete event                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `ToolCallInputEvent`             | Tool call input delta (streaming input JSON)                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `ToolCallStartEvent`             | Tool call start event                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `ToolResultEvent`                | Tool result event                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts)                    |
| `UploadResult`                   | Upload result                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts)           |
| `WebSocketHandlerConfig`         | Configuration for a registry-owned WebSocket upgrade handler.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts)      |
| `WebSocketPublisherConfig`       | WebSocket publisher configuration                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts)      |
| `WorkspaceConfig`                | Workspace configuration                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts)           |
| `WorkspaceSyncResult`            | Workspace sync result                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts)           |

#### Constants

| Name             | Description                                 | Source                                                                                           |
| ---------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `bugFixTool`     | Bug fix tool (code mode)                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts) |
| `claudeCodeTool` | Claude Code tool for workflow steps         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts) |
| `codeReviewTool` | Code review tool (analysis mode, read-only) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts) |
| `docsTool`       | Documentation tool (code mode)              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts) |
| `refactorTool`   | Refactoring tool (code mode)                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts) |

### `veryfront/workflow/claude-code/react`

React hooks for Claude Code streaming

```ts
import {
  useClaudeCodeStream,
  useClaudeCodeText,
  useClaudeCodeWebSocket,
} from "veryfront/workflow/claude-code/react";
```

#### Functions

| Name                     | Description                                          | Source                                                                                                                      |
| ------------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `useClaudeCodeStream`    | React hook for streaming Claude Code execution       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-stream.ts)    |
| `useClaudeCodeText`      | Simplified hook that returns just the streaming text | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-stream.ts)    |
| `useClaudeCodeWebSocket` | React hook for bidirectional Claude Code streaming   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts) |

#### Types

| Name                            | Description                             | Source                                                                                                                      |
| ------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `PendingApproval`               | Pending approval state                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts) |
| `PendingInput`                  | Pending input request state             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts) |
| `UseClaudeCodeStreamOptions`    | Options for useClaudeCodeStream hook    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-stream.ts)    |
| `UseClaudeCodeStreamState`      | State for Claude Code streaming         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-stream.ts)    |
| `UseClaudeCodeWebSocketActions` | Actions returned by the hook            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts) |
| `UseClaudeCodeWebSocketOptions` | Options for useClaudeCodeWebSocket hook | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts) |
| `UseClaudeCodeWebSocketState`   | State for Claude Code WebSocket         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts) |

### `veryfront/workflow/claude-code/types`

Claude Agent SDK Integration Types Type definitions for the Claude Agent SDK workflow tools.

```ts
import {
  MAX_CLAUDE_CODE_WIRE_ARRAY_ITEMS,
  MAX_CLAUDE_CODE_WIRE_FIELD_LENGTH,
  MAX_CLAUDE_CODE_WIRE_IDENTIFIER_LENGTH,
} from "veryfront/workflow/claude-code/types";
```

#### Components

| Name                                     | Description                                            | Source                                                                                            |
| ---------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `MAX_CLAUDE_CODE_WIRE_ARRAY_ITEMS`       | Maximum array entries in structured wire data.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `MAX_CLAUDE_CODE_WIRE_FIELD_LENGTH`      | Maximum UTF-16 length of one non-identity wire field.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `MAX_CLAUDE_CODE_WIRE_IDENTIFIER_LENGTH` | Maximum UTF-16 length of a wire identity.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `MAX_CLAUDE_CODE_WIRE_JSON_DEPTH`        | Maximum nesting depth in structured wire data.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `MAX_CLAUDE_CODE_WIRE_JSON_NODES`        | Maximum aggregate nodes in structured wire data.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `MAX_CLAUDE_CODE_WIRE_KEY_LENGTH`        | Maximum UTF-16 length of a structured wire object key. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `MAX_CLAUDE_CODE_WIRE_MESSAGE_BYTES`     | Maximum encoded size of one Claude Code wire message.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `MAX_CLAUDE_CODE_WIRE_OBJECT_FIELDS`     | Maximum own fields on one structured wire object.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |

#### Types

| Name                          | Description                                                                      | Source                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `ApprovalRequestEvent`        | Approval request event (sent to client when tool needs approval)                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ApproveCommand`              | Approve a pending tool call                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `BidirectionalPublisher`      | Bidirectional publisher interface (WebSocket)                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `CancelCommand`               | Cancel the running agent                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `CancelledEvent`              | Cancelled event                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ClaudeCodeEvent`             | Union of all event types                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ClaudeCodeEventBase`         | Base event interface                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ClaudeCodeEventBaseExtended` | Base interface for extended events (bidirectional communication)                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ClaudeCodeEventExtended`     | Extended event union including bidirectional events                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ClaudeCodeEventHandler`      | Event subscriber callback                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ClaudeCodeEventPublisher`    | Event publisher interface for streaming events                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ClaudeCodeEventSubscriber`   | Event subscriber interface for receiving events                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ClaudeCodeEventType`         | Event types for streaming Claude Code execution                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ClaudeCodeEventTypeExtended` | Extended event type including bidirectional events                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ClaudeCodeMode`              | Tool modes for Claude Code agent                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ClaudeCodeResult`            | Final result from agent execution                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ClaudeCodeToolInput`         | Input schema type for claude-code workflow tools                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ClientCommand`               | Union of all client commands                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ClientCommandDisposition`    | Handler for client commands                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ClientCommandHandler`        |                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ClientCommandObserver`       | Passive command observer. Its completion never controls command acknowledgement. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ClientCommandType`           | Client command types for WebSocket communication                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `CommandAckEvent`             | Acknowledges the semantic disposition of a keyed client command.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `CompleteEvent`               | Complete event (agent finished)                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ErrorEvent`                  | Error event                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `FileChange`                  | File change from workspace operations                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `InputCommand`                | Send user input to the agent                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `InputRequestEvent`           | Input request event (sent to client when agent needs user input)                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `IterationCompleteEvent`      | Iteration complete event                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `IterationStartEvent`         | Iteration start event                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `PingCommand`                 | Keepalive ping                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `PongEvent`                   | Pong response to ping                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `RejectCommand`               | Reject a pending tool call                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `TextCompleteEvent`           | Text complete event                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `TextDeltaEvent`              | Text delta event (streaming text chunk)                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ThinkingCompleteEvent`       | Thinking complete event                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ThinkingDeltaEvent`          | Thinking delta event                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ThinkingStartEvent`          | Thinking start event (extended thinking)                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ToolApprovalConfig`          | Tool approval configuration                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ToolCallCompleteEvent`       | Tool call complete event                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ToolCallInputEvent`          | Tool call input delta (streaming input JSON)                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ToolCallStartEvent`          | Tool call start event                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |
| `ToolResultEvent`             | Tool result event                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts) |

### `veryfront/workflow/discovery`

Workflow Discovery Module Provides utilities for discovering workflow definitions from user code.

```ts
import {
  createWorkflowRegistry,
  discoverWorkflows,
  findWorkflowById,
} from "veryfront/workflow/discovery";
```

#### Functions

| Name                     | Description                                          | Source                                                                                                       |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `createWorkflowRegistry` | Create a workflow registry from discovered workflows | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts) |
| `discoverWorkflows`      | Discover all workflows in a project                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts) |
| `findWorkflowById`       | Find a specific workflow by ID                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts) |

#### Types

| Name                       | Description                    | Source                                                                                                       |
| -------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `DiscoveredWorkflow`       | Discovered workflow info       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts) |
| `WorkflowDiscoveryOptions` | Options for workflow discovery | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts) |
| `WorkflowDiscoveryResult`  | Result of workflow discovery   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts) |

### `veryfront/workflow/registry`

```ts
import { getAllWorkflowIds, getWorkflow, registerWorkflow } from "veryfront/workflow/registry";
```

#### Functions

| Name                | Description                                                  | Source                                                                                   |
| ------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `getAllWorkflowIds` | List registered workflow IDs for the current project scope.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts) |
| `getWorkflow`       | Get metadata for a registered workflow by ID.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts) |
| `registerWorkflow`  | Register a workflow definition in the current project scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts) |

#### Types

| Name               | Description                                           | Source                                                                                   |
| ------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `NodeInfo`         | Metadata for one node in a registered workflow graph. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts) |
| `WorkflowMetadata` | Public metadata captured for a registered workflow.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts) |

#### Constants

| Name               | Description                                                    | Source                                                                                   |
| ------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `workflowRegistry` | Project-scoped registry for workflow metadata and definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts) |

### `veryfront/workflow/worker`

Workflow worker module Provides distributed workflow execution support. Two execution profiles are available: 1. **WorkflowWorker** - In-process polling worker - Polls for stalled workflows and resumes them - Good for trusted code or single-tenant deployments - Simple setup, lower overhead 2. **WorkflowRunManager + ProcessRunExecutor** - Local process execution - Spawns child processes for each workflow - Good for local development without K8s/Docker A workflow run can be backed by a run executor without introducing another user-visible execution type.

```ts
import {
  createDynamicWorkflowRunEntrypoint,
  createWorkflowRunEntrypoint,
  createWorkflowRunManager,
} from "veryfront/workflow/worker";
```

#### Components

| Name                 | Description                                         | Source                                                                                                        |
| -------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `DYNAMIC_EXIT_CODES` | Exit codes for the dynamic workflow run entrypoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts) |
| `EXIT_CODES`         | Exit codes for the workflow run entrypoint.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts)         |

#### Functions

| Name                                 | Description                                             | Source                                                                                                        |
| ------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `createDynamicWorkflowRunEntrypoint` | Create a dynamic workflow run entrypoint.               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts) |
| `createWorkflowRunEntrypoint`        | Create a workflow run entrypoint.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts)         |
| `createWorkflowRunManager`           | Create a workflow run manager backed by run executors.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts)            |
| `createWorkflowWorker`               | Create a workflow worker                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts)        |
| `isRunExecutor`                      | Type guard to check if an object implements RunExecutor | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts)        |
| `runDynamicWorkflowRun`              | Run a workflow run with dynamic discovery.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts) |
| `runWorkflowRun`                     | Run the workflow run entrypoint                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts)         |

#### Classes

| Name                 | Description                | Source                                                                                                   |
| -------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `ProcessRunExecutor` | Process run executor       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/process.ts) |
| `WorkflowRunManager` | Workflow run manager       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts)       |
| `WorkflowWorker`     | Implement workflow worker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts)   |

#### Types

| Name                                        | Description                                                         | Source                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `CreateDynamicWorkflowRunEntrypointOptions` | Create a dynamic workflow run entrypoint.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts) |
| `CreateWorkflowRunEntrypointOptions`        | Create a simple workflow run entrypoint script.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts)         |
| `DynamicWorkflowRunEntrypointConfig`        | Configuration for the dynamic workflow run entrypoint.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts) |
| `ManagerStats`                              | Manager statistics                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts)            |
| `ManagerStatus`                             | Manager status                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts)            |
| `ProcessRunExecutorConfig`                  | Process run executor configuration                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/process.ts)      |
| `RunExecutionConfig`                        | Run execution configuration passed to executor                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts)        |
| `RunExecutionInfo`                          | Run execution information returned by executor                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts)        |
| `RunExecutionStatus`                        | Run execution status                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts)        |
| `RunExecutor`                               | Run Executor Interface                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts)        |
| `WorkerStats`                               | Worker statistics                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts)        |
| `WorkerStatus`                              | Worker status                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts)        |
| `WorkflowRunEntrypointConfig`               | Configuration for the workflow run entrypoint.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts)         |
| `WorkflowRunManagerConfig`                  | Configuration for the workflow run manager backed by run executors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts)            |
| `WorkflowWorkerConfig`                      | Configuration for the workflow worker                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts)        |
