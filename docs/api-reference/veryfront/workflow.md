---
title: "veryfront/workflow"
description: "DAG-based agentic workflows with human-in-the-loop support."
order: 44
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

| Property                   | Type                                                                                                  | Description                                                           | Source                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `id`                       | `string`                                                                                              | Unique workflow identifier                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L23) |
| `description?`             | `string`                                                                                              | Human-readable description                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L24) |
| `version?`                 | `string`                                                                                              | Semantic version string                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L25) |
| `inputSchema?`             | <code>Schema&lt;TInput&gt;</code>                                                                     | Zod schema for workflow input validation                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L26) |
| `outputSchema?`            | <code>Schema&lt;TOutput&gt;</code>                                                                    | Zod schema for workflow output validation                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L27) |
| `integrationRequirements?` | `ScheduleIntegrationRequirementConfig[]`                                                              | Explicit integration scopes and resources required by scheduled runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L29) |
| `retry?`                   | `RetryConfig`                                                                                         | Retry configuration for failed steps                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L30) |
| `timeout?`                 | `string \| number`                                                                                    | Max execution time (ms)                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L31) |
| `introspect?`              | `boolean`                                                                                             | Enable runtime introspection for debugging                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L32) |
| `steps`                    | <code>WorkflowNode[] &#124; ((context: StepBuilderContext&lt;TInput&gt;) =&gt; WorkflowNode[])</code> | Workflow step definitions                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L33) |
| `onError?`                 | <code>(error: Error, context: WorkflowContext) =&gt; void &#124; Promise&lt;void&gt;</code>           | Error handler called when a step fails                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L36) |
| `onComplete?`              | <code>(result: TOutput, context: WorkflowContext) =&gt; void &#124; Promise&lt;void&gt;</code>        | Callback fired after workflow completes                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L37) |

**Returns:** <code>Workflow&lt;TInput, TOutput&gt;</code>

## Type Reference

### `StepOptions`

Options accepted by step.

| Property      | Type                                                                                                       | Description                                              | Source                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `agent?`      | `string \| Agent`                                                                                          | Agent to run (by ID or instance)                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L14) |
| `tool?`       | `string \| Tool`                                                                                           | Tool to execute (by ID or instance)                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L15) |
| `input?`      | <code>string &#124; Record&lt;string, unknown&gt; &#124; ((context: WorkflowContext) =&gt; unknown)</code> | Step input: static value or function of workflow context | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L16) |
| `checkpoint?` | `boolean`                                                                                                  | Persist state after this step                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L17) |
| `retry?`      | `RetryConfig`                                                                                              | Retry configuration for this step                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L18) |
| `timeout?`    | `string \| number`                                                                                         | Step timeout (ms)                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L19) |
| `skip?`       | <code>(context: WorkflowContext) =&gt; boolean &#124; Promise&lt;boolean&gt;</code>                        | Predicate: skip this step if returns true                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L20) |

### `BranchOptions`

Options accepted by branch.

| Property      | Type                                                                                | Description                          | Source                                                                                         |
| ------------- | ----------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `condition`   | <code>(context: WorkflowContext) =&gt; boolean &#124; Promise&lt;boolean&gt;</code> | Branch predicate function            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L12) |
| `then`        | `WorkflowNode[]`                                                                    | Steps when condition is true         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L13) |
| `else?`       | `WorkflowNode[]`                                                                    | Steps when condition is false        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L14) |
| `checkpoint?` | `boolean`                                                                           | Persist state after this node        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L15) |
| `retry?`      | `RetryConfig`                                                                       | Retry configuration                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L16) |
| `timeout?`    | `string \| number`                                                                  | Node timeout (ms or duration string) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L17) |
| `skip?`       | <code>(context: WorkflowContext) =&gt; boolean &#124; Promise&lt;boolean&gt;</code> | Predicate: skip if returns true      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L18) |

### `ParallelOptions`

Options accepted by parallel.

| Property      | Type                                                                                | Description                                             | Source                                                                                           |
| ------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `strategy?`   | `"all" \| "race" \| "allSettled"`                                                   | Completion strategy (`"all"`, `"race"`, `"allSettled"`) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts#L12) |
| `checkpoint?` | `boolean`                                                                           | Persist state after this node                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts#L13) |
| `retry?`      | `RetryConfig`                                                                       | Retry configuration                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts#L14) |
| `timeout?`    | `string \| number`                                                                  | Node timeout (ms or duration string)                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts#L15) |
| `skip?`       | <code>(context: WorkflowContext) =&gt; boolean &#124; Promise&lt;boolean&gt;</code> | Predicate: skip if returns true                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts#L16) |

## Exports

### Functions

| Name                       | Description                                                                                         | Source                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `agentStep`                | Create a workflow step that runs an agent.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L56)                 |
| `branch`                   | Create a conditional branch node.                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L26)               |
| `createWorkflowClient`     | Create workflow client.                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api/workflow-client.ts#L365)     |
| `createWorkflowHandler`    | Build the HTTP routes the workflow hooks call.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/http/handler.ts#L356)            |
| `dag`                      | Create a directed workflow graph.                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L110)            |
| `delay`                    | Create a simple delay/sleep node.                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts#L74)                 |
| `dependsOn`                | Declare workflow step dependencies.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L137)            |
| `deriveRunEvents`          | Events describing how a run got from `previous` to `next`.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts#L227)                  |
| `doWhile`                  | Create a do-while workflow loop.                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/loop.ts#L109)                |
| `generateId`               | Generate a unique workflow ID                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L755)                   |
| `getAllWorkflowIds`        | List registered workflow IDs for the current project scope.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts#L526)                |
| `getWorkflow`              | Get metadata for a registered workflow by ID.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts#L521)                |
| `getWorkflowTenant`        | Get the current workflow tenant context. Returns undefined if not executing within a workflow step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/executor/step-executor.ts#L55)   |
| `hasRunObservationSupport` | Check whether atomic run observation is available.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L282)          |
| `hasWorkerSupport`         | Check whether worker support is present.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L307)          |
| `isTerminalRunStatus`      | Whether a run in this status can still produce events.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts#L103)                  |
| `loop`                     | Create a loop workflow step.                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/loop.ts#L56)                 |
| `map`                      | Create a mapped workflow step.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/map.ts#L23)                  |
| `parallel`                 | Create a parallel node for concurrent execution of multiple steps.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts#L20)             |
| `parseDuration`            | Parse duration string to milliseconds                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L534)                   |
| `sequence`                 | Create a sequential workflow definition.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L81)             |
| `snapshotRun`              | Reduce a run to the state `deriveRunEvents` compares.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts#L177)                  |
| `step`                     | Create a workflow step definition.                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L24)                 |
| `subWorkflow`              | Create a sub-workflow node for nested execution.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/sub-workflow.ts#L18)         |
| `times`                    | Create a fixed-count workflow loop.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/loop.ts#L132)                |
| `toolStep`                 | Create a workflow step that runs a tool.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L65)                 |
| `unless`                   | Create a branch that only executes if condition is false.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L61)               |
| `useApproval`              | Manage workflow approval interactions.                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-approval.ts#L29)       |
| `useWorkflow`              | React hook for workflow.                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow.ts#L41)       |
| `useWorkflowList`          | List and filter workflow runs.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-list.ts#L35)  |
| `useWorkflowStart`         | React hook for workflow start.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-start.ts#L22) |
| `waitForApproval`          | Create a wait-for-approval node. Pauses until human approves/rejects.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts#L21)                 |
| `waitForEvent`             | Create a wait-for-event node. Pauses until external event is received.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts#L51)                 |
| `when`                     | Create a branch that only executes if condition is true (no else).                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L52)               |
| `workflow`                 | Create a workflow definition.                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L44)             |

### Classes

| Name               | Description                | Source                                                                                                          |
| ------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `MemoryBackend`    | Implement memory backend.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/memory.ts#L111)            |
| `RedisBackend`     | Implement redis backend.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/redis/index.ts#L502)       |
| `WorkflowClient`   | Implement workflow client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api/workflow-client.ts#L52)         |
| `WorkflowExecutor` | Workflow Executor class    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/executor/workflow-executor.ts#L129) |

### Types

| Name                          | Description                                                                                                                                                        | Source                                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `BackendConfig`               | Configuration used by backend.                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L58)              |
| `BranchOptions`               | Options accepted by branch.                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L11)                  |
| `CapturedTenantContext`       | Captured tenant context for multi-tenant workflow execution. Allows tools and framework utilities to access the current tenant without explicit parameter passing. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L334)                      |
| `LoopOptions`                 | Options accepted by loop.                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/loop.ts#L19)                    |
| `MapOptions`                  | Options accepted by map.                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/map.ts#L12)                     |
| `NodeInfo`                    | Metadata for one node in a registered workflow graph.                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts#L73)                    |
| `ParallelOptions`             | Options accepted by parallel.                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts#L11)                |
| `RedisAdapter`                | Standardized Redis Adapter Interface Normalizes differences between Deno and Node Redis clients                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/redis/interface.ts#L4)     |
| `RedisBackendConfig`          | Redis backend configuration                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/redis/types.ts#L21)        |
| `RunEventSnapshot`            | The slice of a run this module diffs against.                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts#L171)                     |
| `StepOptions`                 | Options accepted by step.                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L13)                    |
| `SubWorkflowOptions`          | Options accepted by sub workflow.                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/sub-workflow.ts#L11)            |
| `UseApprovalOptions`          | Options accepted by use approval.                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-approval.ts#L6)           |
| `UseApprovalResult`           | Result returned from use approval.                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-approval.ts#L16)          |
| `UseWorkflowListOptions`      | Options accepted by use workflow list.                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-list.ts#L8)      |
| `UseWorkflowListResult`       | Result returned from use workflow list.                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-list.ts#L20)     |
| `UseWorkflowOptions`          | Options accepted by use workflow.                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow.ts#L14)          |
| `UseWorkflowResult`           | Result returned from use workflow.                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow.ts#L26)          |
| `UseWorkflowStartOptions`     | Options accepted by use workflow start.                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-start.ts#L5)     |
| `UseWorkflowStartResult`      | Result returned from use workflow start.                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-start.ts#L13)    |
| `WaitForApprovalOptions`      | Options accepted by wait for approval.                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts#L6)                     |
| `WaitForEventOptions`         | Options accepted by wait for event.                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts#L43)                    |
| `Workflow`                    | Workflow instance                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L323)                      |
| `WorkflowBackend`             | Public API contract for workflow backend.                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L96)              |
| `WorkflowClientConfig`        | Configuration used by workflow client.                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api/workflow-client.ts#L35)         |
| `WorkflowContext`             | Workflow context containing JSON-representable input and node outputs.                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L61)                       |
| `WorkflowDefinition`          | Workflow definition                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L303)                      |
| `WorkflowExecutorConfig`      | Workflow executor configuration                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/executor/workflow-executor.ts#L71)  |
| `WorkflowHandle`              | Controller for a running workflow.                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/executor/workflow-executor.ts#L107) |
| `WorkflowHandlerOptions`      | Options for `createWorkflowHandler`.                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/http/handler.ts#L35)                |
| `WorkflowHandlers`            | Route handlers to re-export from a catch-all route module.                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/http/handler.ts#L44)                |
| `WorkflowMetadata`            | Public metadata captured for a registered workflow.                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts#L91)                    |
| `WorkflowNode`                | Workflow node                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L294)                      |
| `WorkflowNodeConfig`          | Union of all workflow node configurations                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L282)                      |
| `WorkflowOptions`             | Options accepted by workflow.                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L22)                |
| `WorkflowRun`                 | Workflow run state                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L354)                      |
| `WorkflowRunEvent`            | A persisted workflow transition suitable for streaming to run observers.                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts#L155)                     |
| `WorkflowRunEventObservation` | Subscriber-local event stream derived from one atomic backend observation.                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts#L259)                     |
| `WorkflowRunEventsResult`     | Supported observation stream or an explicit unsupported-backend result.                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api/workflow-client.ts#L47)         |
| `WorkflowRunObservation`      | Atomic initial snapshot and ordered changes for one workflow run.                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L84)              |
| `WorkflowRunObservedState`    | Minimal persisted run state used to derive public workflow events.                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L73)              |
| `WorkflowRunStatusEvent`      | The run as a whole moved to a new status.                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts#L140)                     |
| `WorkflowRunUpdate`           | Run state that may change after the immutable run snapshot is created.                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L12)              |
| `WorkflowStatus`              | Public API contract for workflow status.                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/schemas/workflow.schema.ts#L252)    |
| `WorkflowStepCompletedEvent`  | A step finished successfully.                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts#L116)                     |
| `WorkflowStepFailedEvent`     | A step failed. `error` is the persisted message, absent when none was set.                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts#L124)                     |
| `WorkflowStepSkippedEvent`    | A step was skipped, typically by an unmet branch condition.                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts#L133)                     |
| `WorkflowStepStartedEvent`    | A step began executing.                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts#L108)                     |

### Constants

| Name               | Description                                                    | Source                                                                                        |
| ------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `api`              | Context-aware API that automatically uses the current tenant.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api.ts#L113)      |
| `workflowRegistry` | Project-scoped registry for workflow metadata and definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts#L513) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/workflow/blob`

Provider-neutral blob storage contracts and built-in first-party storage.

```ts
import { assertSafeBlobId, BlobStorageContractName, isSafeBlobId } from "veryfront/workflow/blob";
```

#### Components

| Name                      | Description                                                                     | Source                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `BlobStorageContractName` | Extension contract name for an explicitly selected blob-storage implementation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/types.ts#L37) |

#### Functions

| Name               | Description                                                               | Source                                                                                           |
| ------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `assertSafeBlobId` | Validate an identifier before any blob backend constructs a storage path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/blob-id.ts#L14) |
| `isSafeBlobId`     | Return whether a runtime value is a framework-safe blob identifier.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/blob-id.ts#L8)  |

#### Classes

| Name                        | Description | Source                                                                                                            |
| --------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `LocalBlobStorage`          |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/local-storage.ts#L12)            |
| `VeryfrontCloudBlobStorage` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/veryfront-cloud-storage.ts#L461) |

#### Types

| Name                              | Description        | Source                                                                                                           |
| --------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `BlobRef`                         | Blob Storage Types | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/types.ts#L6)                    |
| `BlobStorage`                     |                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/types.ts#L39)                   |
| `StoreBlobOptions`                |                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/types.ts#L25)                   |
| `VeryfrontCloudBlobStorageConfig` |                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/veryfront-cloud-storage.ts#L94) |

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

| Name                     | Description                                                 | Source                                                                                                               |
| ------------------------ | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `createAgent`            | Create a reusable agent function with preset configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/agent.ts#L256)               |
| `createClaudeCodeTool`   | Create a customized Claude Code tool                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L112)                |
| `createEventPublisher`   | Create an event publisher based on environment              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L298)     |
| `createWebSocketHandler` | Create a WebSocket handler for HTTP upgrade requests.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L677) |
| `createWorkspaceSync`    | Create a workspace sync for a Claude Code run               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L637)      |
| `executeAgent`           | Execute a task using the Claude Agent SDK.                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/agent.ts#L107)               |
| `withWorkspace`          | Execute a function with a synchronized workspace            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L662)      |

#### Classes

| Name                      | Description                                                                                                                                                                                                                                                   | Source                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `AgentController`         | Backwards-compatible single-connection controller.                                                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L1352) |
| `AgentControllerRegistry` | Retains one controller generation per run independently of transient publisher connections. Replacements synchronously retire the old publisher; only an exact publisher token can detach, and only an exact run token can terminally release the controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L1395) |
| `CallbackEventPublisher`  | Simple callback-based publisher Calls a function for each event                                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L239)      |
| `MemoryEventPublisher`    | In-memory event publisher using EventTarget Useful for testing or single-process deployments                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L52)       |
| `MultiEventPublisher`     | Publishes events to multiple publishers                                                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L258)      |
| `RedisEventPublisher`     | Redis-backed publisher whose implementation is supplied by the Redis extension.                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L89)       |
| `SSEEventPublisher`       | Server-Sent Events publisher Writes events directly to a ReadableStream controller                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L156)      |
| `WebSocketPublisher`      | WebSocket-based bidirectional publisher                                                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L190)  |
| `WorkspaceSync`           | Workspace manager for Claude Code execution                                                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L157)       |

#### Types

| Name                             | Description                                                       | Source                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `AgentConfig`                    | Agent configuration                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/agent.ts#L19)                     |
| `AgentControllerConfig`          | Run-scoped controller policy.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L133)      |
| `AgentControllerHandle`          | Run-scoped command surface without transport lifecycle authority. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L143)      |
| `AgentControllerRegistration`    | Opaque ownership token for one run publisher generation.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L170)      |
| `AgentControllerRunRegistration` | Opaque ownership token for one run controller generation.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L160)      |
| `ApprovalRequestEvent`           | Approval request event (sent to client when tool needs approval)  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L396)                    |
| `BidirectionalPublisher`         | Bidirectional publisher interface (WebSocket)                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L471)                    |
| `CancelCommand`                  | Cancel the running agent                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L302)                    |
| `CancelledEvent`                 | Cancelled event                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L429)                    |
| `ClaudeCodeEvent`                | Union of all event types                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L236)                    |
| `ClaudeCodeEventBase`            | Base event interface                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L107)                    |
| `ClaudeCodeEventHandler`         | Event subscriber callback                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L264)                    |
| `ClaudeCodeEventPublisher`       | Event publisher interface for streaming events                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L254)                    |
| `ClaudeCodeEventSubscriber`      | Event subscriber interface for receiving events                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L269)                    |
| `ClaudeCodeEventType`            | Event types for streaming Claude Code execution                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L89)                     |
| `ClaudeCodeMode`                 | Tool modes for Claude Code agent                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L26)                     |
| `ClaudeCodeResult`               | Final result from agent execution                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L44)                     |
| `ClaudeCodeToolInput`            | Input schema type for claude-code workflow tools                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L66)                     |
| `ClientCommand`                  | Union of all client commands                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L348)                    |
| `ClientCommandHandler`           |                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L362)                    |
| `ClientCommandType`              | Client command types for WebSocket communication                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L281)                    |
| `CompleteEvent`                  | Complete event (agent finished)                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L218)                    |
| `ErrorEvent`                     | Error event                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L226)                    |
| `FileChange`                     | File change tracking                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L53)            |
| `InputCommand`                   | Send user input to the agent                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L331)                    |
| `InputRequestEvent`              | Input request event (sent to client when agent needs user input)  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L410)                    |
| `IterationCompleteEvent`         | Iteration complete event                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L185)                    |
| `IterationStartEvent`            | Iteration start event                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L121)                    |
| `PingCommand`                    | Keepalive ping                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L341)                    |
| `PongEvent`                      | Pong response to ping                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L422)                    |
| `RedisEventPublisherConfig`      | Redis Pub/Sub publisher configuration.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L142) |
| `TextCompleteEvent`              | Text complete event                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L138)                    |
| `TextDeltaEvent`                 | Text delta event (streaming text chunk)                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L130)                    |
| `ThinkingCompleteEvent`          | Thinking complete event                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L210)                    |
| `ThinkingDeltaEvent`             | Thinking delta event                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L202)                    |
| `ThinkingStartEvent`             | Thinking start event (extended thinking)                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L195)                    |
| `ToolApprovalConfig`             | Tool approval configuration                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L487)                    |
| `ToolCallCompleteEvent`          | Tool call complete event                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L164)                    |
| `ToolCallInputEvent`             | Tool call input delta (streaming input JSON)                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L155)                    |
| `ToolCallStartEvent`             | Tool call start event                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L146)                    |
| `ToolResultEvent`                | Tool result event                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L174)                    |
| `UploadResult`                   | Upload result                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L90)            |
| `WebSocketHandlerConfig`         | Configuration for a registry-owned WebSocket upgrade handler.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L651)      |
| `WebSocketPublisherConfig`       | WebSocket publisher configuration                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L115)      |
| `WorkspaceConfig`                | Workspace configuration                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L27)            |
| `WorkspaceSyncResult`            | Workspace sync result                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L63)            |

#### Constants

| Name             | Description                                 | Source                                                                                                |
| ---------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `bugFixTool`     | Bug fix tool (code mode)                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L164) |
| `claudeCodeTool` | Claude Code tool for workflow steps         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L78)  |
| `codeReviewTool` | Code review tool (analysis mode, read-only) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L148) |
| `docsTool`       | Documentation tool (code mode)              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L196) |
| `refactorTool`   | Refactoring tool (code mode)                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L180) |

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

| Name                     | Description                                          | Source                                                                                                                           |
| ------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `useClaudeCodeStream`    | React hook for streaming Claude Code execution       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-stream.ts#L107)    |
| `useClaudeCodeText`      | Simplified hook that returns just the streaming text | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-stream.ts#L249)    |
| `useClaudeCodeWebSocket` | React hook for bidirectional Claude Code streaming   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts#L164) |

#### Types

| Name                            | Description                             | Source                                                                                                                           |
| ------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `PendingApproval`               | Pending approval state                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts#L31)  |
| `PendingInput`                  | Pending input request state             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts#L43)  |
| `UseClaudeCodeStreamOptions`    | Options for useClaudeCodeStream hook    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-stream.ts#L39)     |
| `UseClaudeCodeStreamState`      | State for Claude Code streaming         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-stream.ts#L25)     |
| `UseClaudeCodeWebSocketActions` | Actions returned by the hook            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts#L105) |
| `UseClaudeCodeWebSocketOptions` | Options for useClaudeCodeWebSocket hook | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts#L70)  |
| `UseClaudeCodeWebSocketState`   | State for Claude Code WebSocket         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts#L53)  |

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

| Name                                     | Description                                            | Source                                                                                                |
| ---------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `MAX_CLAUDE_CODE_WIRE_ARRAY_ITEMS`       | Maximum array entries in structured wire data.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L13) |
| `MAX_CLAUDE_CODE_WIRE_FIELD_LENGTH`      | Maximum UTF-16 length of one non-identity wire field.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L9)  |
| `MAX_CLAUDE_CODE_WIRE_IDENTIFIER_LENGTH` | Maximum UTF-16 length of a wire identity.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L11) |
| `MAX_CLAUDE_CODE_WIRE_JSON_DEPTH`        | Maximum nesting depth in structured wire data.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L15) |
| `MAX_CLAUDE_CODE_WIRE_JSON_NODES`        | Maximum aggregate nodes in structured wire data.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L17) |
| `MAX_CLAUDE_CODE_WIRE_KEY_LENGTH`        | Maximum UTF-16 length of a structured wire object key. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L21) |
| `MAX_CLAUDE_CODE_WIRE_MESSAGE_BYTES`     | Maximum encoded size of one Claude Code wire message.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L7)  |
| `MAX_CLAUDE_CODE_WIRE_OBJECT_FIELDS`     | Maximum own fields on one structured wire object.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L19) |

#### Types

| Name                          | Description                                                                      | Source                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `ApprovalRequestEvent`        | Approval request event (sent to client when tool needs approval)                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L396) |
| `ApproveCommand`              | Approve a pending tool call                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L310) |
| `BidirectionalPublisher`      | Bidirectional publisher interface (WebSocket)                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L471) |
| `CancelCommand`               | Cancel the running agent                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L302) |
| `CancelledEvent`              | Cancelled event                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L429) |
| `ClaudeCodeEvent`             | Union of all event types                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L236) |
| `ClaudeCodeEventBase`         | Base event interface                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L107) |
| `ClaudeCodeEventBaseExtended` | Base interface for extended events (bidirectional communication)                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L386) |
| `ClaudeCodeEventExtended`     | Extended event union including bidirectional events                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L460) |
| `ClaudeCodeEventHandler`      | Event subscriber callback                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L264) |
| `ClaudeCodeEventPublisher`    | Event publisher interface for streaming events                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L254) |
| `ClaudeCodeEventSubscriber`   | Event subscriber interface for receiving events                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L269) |
| `ClaudeCodeEventType`         | Event types for streaming Claude Code execution                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L89)  |
| `ClaudeCodeEventTypeExtended` | Extended event type including bidirectional events                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L375) |
| `ClaudeCodeMode`              | Tool modes for Claude Code agent                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L26)  |
| `ClaudeCodeResult`            | Final result from agent execution                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L44)  |
| `ClaudeCodeToolInput`         | Input schema type for claude-code workflow tools                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L66)  |
| `ClientCommand`               | Union of all client commands                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L348) |
| `ClientCommandDisposition`    | Handler for client commands                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L358) |
| `ClientCommandHandler`        |                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L362) |
| `ClientCommandObserver`       | Passive command observer. Its completion never controls command acknowledgement. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L370) |
| `ClientCommandType`           | Client command types for WebSocket communication                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L281) |
| `CommandAckEvent`             | Acknowledges the semantic disposition of a keyed client command.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L443) |
| `CompleteEvent`               | Complete event (agent finished)                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L218) |
| `ErrorEvent`                  | Error event                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L226) |
| `FileChange`                  | File change from workspace operations                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L34)  |
| `InputCommand`                | Send user input to the agent                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L331) |
| `InputRequestEvent`           | Input request event (sent to client when agent needs user input)                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L410) |
| `IterationCompleteEvent`      | Iteration complete event                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L185) |
| `IterationStartEvent`         | Iteration start event                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L121) |
| `PingCommand`                 | Keepalive ping                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L341) |
| `PongEvent`                   | Pong response to ping                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L422) |
| `RejectCommand`               | Reject a pending tool call                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L320) |
| `TextCompleteEvent`           | Text complete event                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L138) |
| `TextDeltaEvent`              | Text delta event (streaming text chunk)                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L130) |
| `ThinkingCompleteEvent`       | Thinking complete event                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L210) |
| `ThinkingDeltaEvent`          | Thinking delta event                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L202) |
| `ThinkingStartEvent`          | Thinking start event (extended thinking)                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L195) |
| `ToolApprovalConfig`          | Tool approval configuration                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L487) |
| `ToolCallCompleteEvent`       | Tool call complete event                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L164) |
| `ToolCallInputEvent`          | Tool call input delta (streaming input JSON)                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L155) |
| `ToolCallStartEvent`          | Tool call start event                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L146) |
| `ToolResultEvent`             | Tool result event                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L174) |

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

| Name                     | Description                                          | Source                                                                                                            |
| ------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `createWorkflowRegistry` | Create a workflow registry from discovered workflows | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L327) |
| `discoverWorkflows`      | Discover all workflows in a project                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L206) |
| `findWorkflowById`       | Find a specific workflow by ID                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L313) |

#### Types

| Name                       | Description                    | Source                                                                                                            |
| -------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `DiscoveredWorkflow`       | Discovered workflow info       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L69)  |
| `WorkflowDiscoveryOptions` | Options for workflow discovery | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L86)  |
| `WorkflowDiscoveryResult`  | Result of workflow discovery   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L109) |

### `veryfront/workflow/registry`

```ts
import { getAllWorkflowIds, getWorkflow, registerWorkflow } from "veryfront/workflow/registry";
```

#### Functions

| Name                | Description                                                  | Source                                                                                        |
| ------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `getAllWorkflowIds` | List registered workflow IDs for the current project scope.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts#L526) |
| `getWorkflow`       | Get metadata for a registered workflow by ID.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts#L521) |
| `registerWorkflow`  | Register a workflow definition in the current project scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts#L516) |

#### Types

| Name               | Description                                           | Source                                                                                       |
| ------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `NodeInfo`         | Metadata for one node in a registered workflow graph. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts#L73) |
| `WorkflowMetadata` | Public metadata captured for a registered workflow.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts#L91) |

#### Constants

| Name               | Description                                                    | Source                                                                                        |
| ------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `workflowRegistry` | Project-scoped registry for workflow metadata and definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts#L513) |

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

| Name                 | Description                                         | Source                                                                                                            |
| -------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `DYNAMIC_EXIT_CODES` | Exit codes for the dynamic workflow run entrypoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts#L58) |
| `EXIT_CODES`         | Exit codes for the workflow run entrypoint.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts#L62)         |

#### Functions

| Name                                 | Description                                             | Source                                                                                                             |
| ------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `createDynamicWorkflowRunEntrypoint` | Create a dynamic workflow run entrypoint.               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts#L279) |
| `createWorkflowRunEntrypoint`        | Create a workflow run entrypoint.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts#L206)         |
| `createWorkflowRunManager`           | Create a workflow run manager backed by run executors.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts#L441)            |
| `createWorkflowWorker`               | Create a workflow worker                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts#L340)        |
| `isRunExecutor`                      | Type guard to check if an object implements RunExecutor | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts#L129)        |
| `runDynamicWorkflowRun`              | Run a workflow run with dynamic discovery.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts#L88)  |
| `runWorkflowRun`                     | Run the workflow run entrypoint                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts#L97)          |

#### Classes

| Name                 | Description                | Source                                                                                                        |
| -------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `ProcessRunExecutor` | Process run executor       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/process.ts#L125) |
| `WorkflowRunManager` | Workflow run manager       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts#L125)       |
| `WorkflowWorker`     | Implement workflow worker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts#L102)   |

#### Types

| Name                                        | Description                                                         | Source                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `CreateDynamicWorkflowRunEntrypointOptions` | Create a dynamic workflow run entrypoint.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts#L270) |
| `CreateWorkflowRunEntrypointOptions`        | Create a simple workflow run entrypoint script.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts#L194)         |
| `DynamicWorkflowRunEntrypointConfig`        | Configuration for the dynamic workflow run entrypoint.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts#L69)  |
| `ManagerStats`                              | Manager statistics                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts#L74)             |
| `ManagerStatus`                             | Manager status                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts#L69)             |
| `ProcessRunExecutorConfig`                  | Process run executor configuration                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/process.ts#L66)       |
| `RunExecutionConfig`                        | Run execution configuration passed to executor                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts#L15)         |
| `RunExecutionInfo`                          | Run execution information returned by executor                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts#L43)         |
| `RunExecutionStatus`                        | Run execution status                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts#L38)         |
| `RunExecutor`                               | Run Executor Interface                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts#L90)         |
| `WorkerStats`                               | Worker statistics                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts#L60)         |
| `WorkerStatus`                              | Worker status                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts#L55)         |
| `WorkflowRunEntrypointConfig`               | Configuration for the workflow run entrypoint.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts#L48)          |
| `WorkflowRunManagerConfig`                  | Configuration for the workflow run manager backed by run executors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts#L40)             |
| `WorkflowWorkerConfig`                      | Configuration for the workflow worker                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts#L29)         |
