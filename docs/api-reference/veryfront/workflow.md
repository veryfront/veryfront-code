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
| `id`                       | `string`                                                                                              | Unique workflow identifier                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L24) |
| `description?`             | `string`                                                                                              | Human-readable description                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L25) |
| `version?`                 | `string`                                                                                              | Semantic version string                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L26) |
| `inputSchema?`             | <code>Schema&lt;TInput&gt;</code>                                                                     | Zod schema for workflow input validation                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L27) |
| `outputSchema?`            | <code>Schema&lt;TOutput&gt;</code>                                                                    | Zod schema for workflow output validation                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L28) |
| `integrationRequirements?` | `ScheduleIntegrationRequirementConfig[]`                                                              | Explicit integration scopes and resources required by scheduled runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L30) |
| `retry?`                   | `RetryConfig`                                                                                         | Retry configuration for failed steps                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L31) |
| `timeout?`                 | `string \| number`                                                                                    | Max execution time (ms)                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L32) |
| `introspect?`              | `boolean`                                                                                             | Enable runtime introspection for debugging                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L33) |
| `steps`                    | <code>WorkflowNode[] &#124; ((context: StepBuilderContext&lt;TInput&gt;) =&gt; WorkflowNode[])</code> | Workflow step definitions                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L34) |
| `onError?`                 | <code>(error: Error, context: WorkflowContext) =&gt; void &#124; Promise&lt;void&gt;</code>           | Error handler called when a step fails                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L37) |
| `onComplete?`              | <code>(result: TOutput, context: WorkflowContext) =&gt; void &#124; Promise&lt;void&gt;</code>        | Callback fired after workflow completes                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L38) |

**Returns:** <code>Workflow&lt;TInput, TOutput&gt;</code>

## Type Reference

### `StepOptions`

Options accepted by step.

| Property      | Type                                                                                                       | Description                                              | Source                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `agent?`      | `string \| Agent`                                                                                          | Agent to run (by ID or instance)                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L15) |
| `tool?`       | `string \| Tool`                                                                                           | Tool to execute (by ID or instance)                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L16) |
| `input?`      | <code>string &#124; Record&lt;string, unknown&gt; &#124; ((context: WorkflowContext) =&gt; unknown)</code> | Step input: static value or function of workflow context | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L17) |
| `checkpoint?` | `boolean`                                                                                                  | Persist state after this step                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L18) |
| `retry?`      | `RetryConfig`                                                                                              | Retry configuration for this step                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L19) |
| `timeout?`    | `string \| number`                                                                                         | Step timeout (ms)                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L20) |
| `skip?`       | <code>(context: WorkflowContext) =&gt; boolean &#124; Promise&lt;boolean&gt;</code>                        | Predicate: skip this step if returns true                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L21) |

### `BranchOptions`

Options accepted by branch.

| Property      | Type                                                                                | Description                          | Source                                                                                         |
| ------------- | ----------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `condition`   | <code>(context: WorkflowContext) =&gt; boolean &#124; Promise&lt;boolean&gt;</code> | Branch predicate function            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L13) |
| `then`        | `WorkflowNode[]`                                                                    | Steps when condition is true         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L14) |
| `else?`       | `WorkflowNode[]`                                                                    | Steps when condition is false        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L15) |
| `checkpoint?` | `boolean`                                                                           | Persist state after this node        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L16) |
| `retry?`      | `RetryConfig`                                                                       | Retry configuration                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L17) |
| `timeout?`    | `string \| number`                                                                  | Node timeout (ms or duration string) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L18) |
| `skip?`       | <code>(context: WorkflowContext) =&gt; boolean &#124; Promise&lt;boolean&gt;</code> | Predicate: skip if returns true      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L19) |

### `ParallelOptions`

Options accepted by parallel.

| Property      | Type                                                                                | Description                                             | Source                                                                                           |
| ------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `strategy?`   | `"all" \| "race" \| "allSettled"`                                                   | Completion strategy (`"all"`, `"race"`, `"allSettled"`) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts#L13) |
| `checkpoint?` | `boolean`                                                                           | Persist state after this node                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts#L14) |
| `retry?`      | `RetryConfig`                                                                       | Retry configuration                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts#L15) |
| `timeout?`    | `string \| number`                                                                  | Node timeout (ms or duration string)                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts#L16) |
| `skip?`       | <code>(context: WorkflowContext) =&gt; boolean &#124; Promise&lt;boolean&gt;</code> | Predicate: skip if returns true                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts#L17) |

## Exports

### Functions

| Name                       | Description                                                                                         | Source                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `agentStep`                | Create a workflow step that runs an agent.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L57)                 |
| `branch`                   | Create a conditional branch node.                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L27)               |
| `createWorkflowClient`     | Create workflow client.                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api/workflow-client.ts#L275)     |
| `createWorkflowHandler`    | Build the HTTP routes the workflow hooks call.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/http/handler.ts#L356)            |
| `dag`                      | Create a directed workflow graph.                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L111)            |
| `delay`                    | Create a simple delay/sleep node.                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts#L75)                 |
| `dependsOn`                | Declare workflow step dependencies.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L138)            |
| `deriveRunEvents`          | Events describing how a run got from `previous` to `next`.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts#L265)                  |
| `doWhile`                  | Create a do-while workflow loop.                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/loop.ts#L110)                |
| `generateId`               | Generate a unique workflow ID                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L756)                   |
| `getAllWorkflowIds`        | List registered workflow IDs for the current project scope.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts#L527)                |
| `getWorkflow`              | Get metadata for a registered workflow by ID.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts#L522)                |
| `getWorkflowTenant`        | Get the current workflow tenant context. Returns undefined if not executing within a workflow step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/executor/step-executor.ts#L56)   |
| `hasRunObservationSupport` | Check whether atomic run observation is available.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L285)          |
| `hasWorkerSupport`         | Check whether worker support is present.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L310)          |
| `isTerminalRunStatus`      | Whether a run in this status can still produce events.                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts#L104)                  |
| `loop`                     | Create a loop workflow step.                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/loop.ts#L57)                 |
| `map`                      | Create a mapped workflow step.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/map.ts#L24)                  |
| `parallel`                 | Create a parallel node for concurrent execution of multiple steps.                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts#L21)             |
| `parseDuration`            | Parse duration string to milliseconds                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L535)                   |
| `sequence`                 | Create a sequential workflow definition.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L82)             |
| `snapshotRun`              | Reduce a run to the state `deriveRunEvents` compares.                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts#L201)                  |
| `step`                     | Create a workflow step definition.                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L25)                 |
| `subWorkflow`              | Create a sub-workflow node for nested execution.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/sub-workflow.ts#L19)         |
| `times`                    | Create a fixed-count workflow loop.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/loop.ts#L133)                |
| `toolStep`                 | Create a workflow step that runs a tool.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L66)                 |
| `unless`                   | Create a branch that only executes if condition is false.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L62)               |
| `useApproval`              | Manage workflow approval interactions.                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-approval.ts#L30)       |
| `useWorkflow`              | React hook for workflow.                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow.ts#L42)       |
| `useWorkflowList`          | List and filter workflow runs.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-list.ts#L36)  |
| `useWorkflowStart`         | React hook for workflow start.                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-start.ts#L23) |
| `waitForApproval`          | Create a wait-for-approval node. Pauses until human approves/rejects.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts#L22)                 |
| `waitForEvent`             | Create a wait-for-event node. Pauses until external event is received.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts#L52)                 |
| `when`                     | Create a branch that only executes if condition is true (no else).                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L53)               |
| `workflow`                 | Create a workflow definition.                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L45)             |

### Classes

| Name               | Description                | Source                                                                                                          |
| ------------------ | -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `MemoryBackend`    | Implement memory backend.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/memory.ts#L112)            |
| `RedisBackend`     | Implement redis backend.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/redis/index.ts#L655)       |
| `WorkflowClient`   | Implement workflow client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api/workflow-client.ts#L48)         |
| `WorkflowExecutor` | Workflow Executor class    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/executor/workflow-executor.ts#L124) |

### Types

| Name                           | Description                                                                                                                                                        | Source                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `BackendConfig`                | Configuration used by backend.                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L59)              |
| `BranchOptions`                | Options accepted by branch.                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L12)                  |
| `CapturedTenantContext`        | Captured tenant context for multi-tenant workflow execution. Allows tools and framework utilities to access the current tenant without explicit parameter passing. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L335)                      |
| `LoopOptions`                  | Options accepted by loop.                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/loop.ts#L20)                    |
| `MapOptions`                   | Options accepted by map.                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/map.ts#L13)                     |
| `NodeInfo`                     | Metadata for one node in a registered workflow graph.                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts#L74)                    |
| `ParallelOptions`              | Options accepted by parallel.                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts#L12)                |
| `RedisAdapter`                 | Standardized Redis Adapter Interface Normalizes differences between Deno and Node Redis clients                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/redis/interface.ts#L5)     |
| `RedisBackendConfig`           | Redis backend configuration                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/redis/types.ts#L22)        |
| `RunEventSnapshot`             | The slice of a run this module diffs against.                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts#L190)                     |
| `StepOptions`                  | Options accepted by step.                                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L14)                    |
| `SubWorkflowOptions`           | Options accepted by sub workflow.                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/sub-workflow.ts#L12)            |
| `UseApprovalOptions`           | Options accepted by use approval.                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-approval.ts#L7)           |
| `UseApprovalResult`            | Result returned from use approval.                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-approval.ts#L17)          |
| `UseWorkflowListOptions`       | Options accepted by use workflow list.                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-list.ts#L9)      |
| `UseWorkflowListResult`        | Result returned from use workflow list.                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-list.ts#L21)     |
| `UseWorkflowOptions`           | Options accepted by use workflow.                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow.ts#L15)          |
| `UseWorkflowResult`            | Result returned from use workflow.                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow.ts#L27)          |
| `UseWorkflowStartOptions`      | Options accepted by use workflow start.                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-start.ts#L6)     |
| `UseWorkflowStartResult`       | Result returned from use workflow start.                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-start.ts#L14)    |
| `WaitForApprovalOptions`       | Options accepted by wait for approval.                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts#L7)                     |
| `WaitForEventOptions`          | Options accepted by wait for event.                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts#L44)                    |
| `Workflow`                     | Workflow instance                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L324)                      |
| `WorkflowApprovalPendingEvent` | A pending approval was persisted; the run is parked until it is decided.                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts#L156)                     |
| `WorkflowBackend`              | Public API contract for workflow backend.                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L99)              |
| `WorkflowClientConfig`         | Configuration used by workflow client.                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api/workflow-client.ts#L31)         |
| `WorkflowContext`              | Workflow context containing JSON-representable input and node outputs.                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L62)                       |
| `WorkflowDefinition`           | Workflow definition                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L304)                      |
| `WorkflowExecutorConfig`       | Workflow executor configuration                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/executor/workflow-executor.ts#L70)  |
| `WorkflowHandle`               | Controller for a running workflow.                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/executor/workflow-executor.ts#L102) |
| `WorkflowHandlerOptions`       | Options for `createWorkflowHandler`.                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/http/handler.ts#L35)                |
| `WorkflowHandlers`             | Route handlers to re-export from a catch-all route module.                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/http/handler.ts#L44)                |
| `WorkflowMetadata`             | Public metadata captured for a registered workflow.                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts#L92)                    |
| `WorkflowNode`                 | Workflow node                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L295)                      |
| `WorkflowNodeConfig`           | Union of all workflow node configurations                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L283)                      |
| `WorkflowOptions`              | Options accepted by workflow.                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L23)                |
| `WorkflowRun`                  | Workflow run state                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L355)                      |
| `WorkflowRunEvent`             | A persisted workflow transition suitable for streaming to run observers.                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts#L172)                     |
| `WorkflowRunEventObservation`  | Subscriber-local event stream derived from one atomic backend observation.                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts#L319)                     |
| `WorkflowRunEventsResult`      | Supported observation stream or an explicit unsupported-backend result.                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api/workflow-client.ts#L43)         |
| `WorkflowRunObservation`       | Atomic initial snapshot and ordered changes for one workflow run.                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L92)              |
| `WorkflowRunObservedState`     | Minimal persisted run state used to derive public workflow events.                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L74)              |
| `WorkflowRunStatusEvent`       | The run as a whole moved to a new status.                                                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts#L141)                     |
| `WorkflowRunUpdate`            | Run state that may change after the immutable run snapshot is created.                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L13)              |
| `WorkflowStatus`               | Public API contract for workflow status.                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/schemas/workflow.schema.ts#L253)    |
| `WorkflowStepCompletedEvent`   | A step finished successfully.                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts#L117)                     |
| `WorkflowStepFailedEvent`      | A step failed. `error` is the persisted message, absent when none was set.                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts#L125)                     |
| `WorkflowStepSkippedEvent`     | A step was skipped, typically by an unmet branch condition.                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts#L134)                     |
| `WorkflowStepStartedEvent`     | A step began executing.                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/events.ts#L109)                     |

### Constants

| Name               | Description                                                    | Source                                                                                        |
| ------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `api`              | Context-aware API that automatically uses the current tenant.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api.ts#L114)      |
| `workflowRegistry` | Project-scoped registry for workflow metadata and definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts#L514) |

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
| `BlobStorageContractName` | Extension contract name for an explicitly selected blob-storage implementation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/types.ts#L38) |

#### Functions

| Name               | Description                                                               | Source                                                                                           |
| ------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `assertSafeBlobId` | Validate an identifier before any blob backend constructs a storage path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/blob-id.ts#L15) |
| `isSafeBlobId`     | Return whether a runtime value is a framework-safe blob identifier.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/blob-id.ts#L9)  |

#### Classes

| Name                        | Description | Source                                                                                                            |
| --------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| `LocalBlobStorage`          |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/local-storage.ts#L13)            |
| `VeryfrontCloudBlobStorage` |             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/veryfront-cloud-storage.ts#L462) |

#### Types

| Name                              | Description        | Source                                                                                                           |
| --------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `BlobRef`                         | Blob Storage Types | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/types.ts#L7)                    |
| `BlobStorage`                     |                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/types.ts#L40)                   |
| `StoreBlobOptions`                |                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/types.ts#L26)                   |
| `VeryfrontCloudBlobStorageConfig` |                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/veryfront-cloud-storage.ts#L95) |

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
| `createAgent`            | Create a reusable agent function with preset configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/agent.ts#L257)               |
| `createClaudeCodeTool`   | Create a customized Claude Code tool                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L113)                |
| `createEventPublisher`   | Create an event publisher based on environment              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L299)     |
| `createWebSocketHandler` | Create a WebSocket handler for HTTP upgrade requests.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L678) |
| `createWorkspaceSync`    | Create a workspace sync for a Claude Code run               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L638)      |
| `executeAgent`           | Execute a task using the Claude Agent SDK.                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/agent.ts#L108)               |
| `withWorkspace`          | Execute a function with a synchronized workspace            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L663)      |

#### Classes

| Name                      | Description                                                                                                                                                                                                                                                   | Source                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `AgentController`         | Backwards-compatible single-connection controller.                                                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L1353) |
| `AgentControllerRegistry` | Retains one controller generation per run independently of transient publisher connections. Replacements synchronously retire the old publisher; only an exact publisher token can detach, and only an exact run token can terminally release the controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L1396) |
| `CallbackEventPublisher`  | Simple callback-based publisher Calls a function for each event                                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L240)      |
| `MemoryEventPublisher`    | In-memory event publisher using EventTarget Useful for testing or single-process deployments                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L53)       |
| `MultiEventPublisher`     | Publishes events to multiple publishers                                                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L259)      |
| `RedisEventPublisher`     | Redis-backed publisher whose implementation is supplied by the Redis extension.                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L90)       |
| `SSEEventPublisher`       | Server-Sent Events publisher Writes events directly to a ReadableStream controller                                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L157)      |
| `WebSocketPublisher`      | WebSocket-based bidirectional publisher                                                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L191)  |
| `WorkspaceSync`           | Workspace manager for Claude Code execution                                                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L158)       |

#### Types

| Name                             | Description                                                       | Source                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `AgentConfig`                    | Agent configuration                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/agent.ts#L20)                     |
| `AgentControllerConfig`          | Run-scoped controller policy.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L134)      |
| `AgentControllerHandle`          | Run-scoped command surface without transport lifecycle authority. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L144)      |
| `AgentControllerRegistration`    | Opaque ownership token for one run publisher generation.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L171)      |
| `AgentControllerRunRegistration` | Opaque ownership token for one run controller generation.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L161)      |
| `ApprovalRequestEvent`           | Approval request event (sent to client when tool needs approval)  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L397)                    |
| `BidirectionalPublisher`         | Bidirectional publisher interface (WebSocket)                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L472)                    |
| `CancelCommand`                  | Cancel the running agent                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L303)                    |
| `CancelledEvent`                 | Cancelled event                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L430)                    |
| `ClaudeCodeEvent`                | Union of all event types                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L237)                    |
| `ClaudeCodeEventBase`            | Base event interface                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L108)                    |
| `ClaudeCodeEventHandler`         | Event subscriber callback                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L265)                    |
| `ClaudeCodeEventPublisher`       | Event publisher interface for streaming events                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L255)                    |
| `ClaudeCodeEventSubscriber`      | Event subscriber interface for receiving events                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L270)                    |
| `ClaudeCodeEventType`            | Event types for streaming Claude Code execution                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L90)                     |
| `ClaudeCodeMode`                 | Tool modes for Claude Code agent                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L27)                     |
| `ClaudeCodeResult`               | Final result from agent execution                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L45)                     |
| `ClaudeCodeToolInput`            | Input schema type for claude-code workflow tools                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L67)                     |
| `ClientCommand`                  | Union of all client commands                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L349)                    |
| `ClientCommandHandler`           |                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L363)                    |
| `ClientCommandType`              | Client command types for WebSocket communication                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L282)                    |
| `CompleteEvent`                  | Complete event (agent finished)                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L219)                    |
| `ErrorEvent`                     | Error event                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L227)                    |
| `FileChange`                     | File change tracking                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L54)            |
| `InputCommand`                   | Send user input to the agent                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L332)                    |
| `InputRequestEvent`              | Input request event (sent to client when agent needs user input)  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L411)                    |
| `IterationCompleteEvent`         | Iteration complete event                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L186)                    |
| `IterationStartEvent`            | Iteration start event                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L122)                    |
| `PingCommand`                    | Keepalive ping                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L342)                    |
| `PongEvent`                      | Pong response to ping                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L423)                    |
| `RedisEventPublisherConfig`      | Redis Pub/Sub publisher configuration.                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/redis-runtime-provider.ts#L143) |
| `TextCompleteEvent`              | Text complete event                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L139)                    |
| `TextDeltaEvent`                 | Text delta event (streaming text chunk)                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L131)                    |
| `ThinkingCompleteEvent`          | Thinking complete event                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L211)                    |
| `ThinkingDeltaEvent`             | Thinking delta event                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L203)                    |
| `ThinkingStartEvent`             | Thinking start event (extended thinking)                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L196)                    |
| `ToolApprovalConfig`             | Tool approval configuration                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L488)                    |
| `ToolCallCompleteEvent`          | Tool call complete event                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L165)                    |
| `ToolCallInputEvent`             | Tool call input delta (streaming input JSON)                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L156)                    |
| `ToolCallStartEvent`             | Tool call start event                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L147)                    |
| `ToolResultEvent`                | Tool result event                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L175)                    |
| `UploadResult`                   | Upload result                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L91)            |
| `WebSocketHandlerConfig`         | Configuration for a registry-owned WebSocket upgrade handler.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L652)      |
| `WebSocketPublisherConfig`       | WebSocket publisher configuration                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L116)      |
| `WorkspaceConfig`                | Workspace configuration                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L28)            |
| `WorkspaceSyncResult`            | Workspace sync result                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L64)            |

#### Constants

| Name             | Description                                 | Source                                                                                                |
| ---------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `bugFixTool`     | Bug fix tool (code mode)                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L165) |
| `claudeCodeTool` | Claude Code tool for workflow steps         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L79)  |
| `codeReviewTool` | Code review tool (analysis mode, read-only) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L149) |
| `docsTool`       | Documentation tool (code mode)              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L197) |
| `refactorTool`   | Refactoring tool (code mode)                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L181) |

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
| `useClaudeCodeStream`    | React hook for streaming Claude Code execution       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-stream.ts#L108)    |
| `useClaudeCodeText`      | Simplified hook that returns just the streaming text | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-stream.ts#L250)    |
| `useClaudeCodeWebSocket` | React hook for bidirectional Claude Code streaming   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts#L165) |

#### Types

| Name                            | Description                             | Source                                                                                                                           |
| ------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `PendingApproval`               | Pending approval state                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts#L32)  |
| `PendingInput`                  | Pending input request state             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts#L44)  |
| `UseClaudeCodeStreamOptions`    | Options for useClaudeCodeStream hook    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-stream.ts#L40)     |
| `UseClaudeCodeStreamState`      | State for Claude Code streaming         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-stream.ts#L26)     |
| `UseClaudeCodeWebSocketActions` | Actions returned by the hook            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts#L106) |
| `UseClaudeCodeWebSocketOptions` | Options for useClaudeCodeWebSocket hook | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts#L71)  |
| `UseClaudeCodeWebSocketState`   | State for Claude Code WebSocket         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts#L54)  |

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
| `MAX_CLAUDE_CODE_WIRE_ARRAY_ITEMS`       | Maximum array entries in structured wire data.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L14) |
| `MAX_CLAUDE_CODE_WIRE_FIELD_LENGTH`      | Maximum UTF-16 length of one non-identity wire field.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L10) |
| `MAX_CLAUDE_CODE_WIRE_IDENTIFIER_LENGTH` | Maximum UTF-16 length of a wire identity.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L12) |
| `MAX_CLAUDE_CODE_WIRE_JSON_DEPTH`        | Maximum nesting depth in structured wire data.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L16) |
| `MAX_CLAUDE_CODE_WIRE_JSON_NODES`        | Maximum aggregate nodes in structured wire data.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L18) |
| `MAX_CLAUDE_CODE_WIRE_KEY_LENGTH`        | Maximum UTF-16 length of a structured wire object key. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L22) |
| `MAX_CLAUDE_CODE_WIRE_MESSAGE_BYTES`     | Maximum encoded size of one Claude Code wire message.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L8)  |
| `MAX_CLAUDE_CODE_WIRE_OBJECT_FIELDS`     | Maximum own fields on one structured wire object.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L20) |

#### Types

| Name                          | Description                                                                      | Source                                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `ApprovalRequestEvent`        | Approval request event (sent to client when tool needs approval)                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L397) |
| `ApproveCommand`              | Approve a pending tool call                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L311) |
| `BidirectionalPublisher`      | Bidirectional publisher interface (WebSocket)                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L472) |
| `CancelCommand`               | Cancel the running agent                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L303) |
| `CancelledEvent`              | Cancelled event                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L430) |
| `ClaudeCodeEvent`             | Union of all event types                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L237) |
| `ClaudeCodeEventBase`         | Base event interface                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L108) |
| `ClaudeCodeEventBaseExtended` | Base interface for extended events (bidirectional communication)                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L387) |
| `ClaudeCodeEventExtended`     | Extended event union including bidirectional events                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L461) |
| `ClaudeCodeEventHandler`      | Event subscriber callback                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L265) |
| `ClaudeCodeEventPublisher`    | Event publisher interface for streaming events                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L255) |
| `ClaudeCodeEventSubscriber`   | Event subscriber interface for receiving events                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L270) |
| `ClaudeCodeEventType`         | Event types for streaming Claude Code execution                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L90)  |
| `ClaudeCodeEventTypeExtended` | Extended event type including bidirectional events                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L376) |
| `ClaudeCodeMode`              | Tool modes for Claude Code agent                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L27)  |
| `ClaudeCodeResult`            | Final result from agent execution                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L45)  |
| `ClaudeCodeToolInput`         | Input schema type for claude-code workflow tools                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L67)  |
| `ClientCommand`               | Union of all client commands                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L349) |
| `ClientCommandDisposition`    | Handler for client commands                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L359) |
| `ClientCommandHandler`        |                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L363) |
| `ClientCommandObserver`       | Passive command observer. Its completion never controls command acknowledgement. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L371) |
| `ClientCommandType`           | Client command types for WebSocket communication                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L282) |
| `CommandAckEvent`             | Acknowledges the semantic disposition of a keyed client command.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L444) |
| `CompleteEvent`               | Complete event (agent finished)                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L219) |
| `ErrorEvent`                  | Error event                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L227) |
| `FileChange`                  | File change from workspace operations                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L35)  |
| `InputCommand`                | Send user input to the agent                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L332) |
| `InputRequestEvent`           | Input request event (sent to client when agent needs user input)                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L411) |
| `IterationCompleteEvent`      | Iteration complete event                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L186) |
| `IterationStartEvent`         | Iteration start event                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L122) |
| `PingCommand`                 | Keepalive ping                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L342) |
| `PongEvent`                   | Pong response to ping                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L423) |
| `RejectCommand`               | Reject a pending tool call                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L321) |
| `TextCompleteEvent`           | Text complete event                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L139) |
| `TextDeltaEvent`              | Text delta event (streaming text chunk)                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L131) |
| `ThinkingCompleteEvent`       | Thinking complete event                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L211) |
| `ThinkingDeltaEvent`          | Thinking delta event                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L203) |
| `ThinkingStartEvent`          | Thinking start event (extended thinking)                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L196) |
| `ToolApprovalConfig`          | Tool approval configuration                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L488) |
| `ToolCallCompleteEvent`       | Tool call complete event                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L165) |
| `ToolCallInputEvent`          | Tool call input delta (streaming input JSON)                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L156) |
| `ToolCallStartEvent`          | Tool call start event                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L147) |
| `ToolResultEvent`             | Tool result event                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L175) |

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
| `createWorkflowRegistry` | Create a workflow registry from discovered workflows | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L328) |
| `discoverWorkflows`      | Discover all workflows in a project                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L207) |
| `findWorkflowById`       | Find a specific workflow by ID                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L314) |

#### Types

| Name                       | Description                    | Source                                                                                                            |
| -------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `DiscoveredWorkflow`       | Discovered workflow info       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L70)  |
| `WorkflowDiscoveryOptions` | Options for workflow discovery | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L87)  |
| `WorkflowDiscoveryResult`  | Result of workflow discovery   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L110) |

### `veryfront/workflow/registry`

```ts
import { getAllWorkflowIds, getWorkflow, registerWorkflow } from "veryfront/workflow/registry";
```

#### Functions

| Name                | Description                                                  | Source                                                                                        |
| ------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `getAllWorkflowIds` | List registered workflow IDs for the current project scope.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts#L527) |
| `getWorkflow`       | Get metadata for a registered workflow by ID.                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts#L522) |
| `registerWorkflow`  | Register a workflow definition in the current project scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts#L517) |

#### Types

| Name               | Description                                           | Source                                                                                       |
| ------------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `NodeInfo`         | Metadata for one node in a registered workflow graph. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts#L74) |
| `WorkflowMetadata` | Public metadata captured for a registered workflow.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts#L92) |

#### Constants

| Name               | Description                                                    | Source                                                                                        |
| ------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `workflowRegistry` | Project-scoped registry for workflow metadata and definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/registry.ts#L514) |

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
| `DYNAMIC_EXIT_CODES` | Exit codes for the dynamic workflow run entrypoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts#L59) |
| `EXIT_CODES`         | Exit codes for the workflow run entrypoint.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts#L63)         |

#### Functions

| Name                                 | Description                                             | Source                                                                                                             |
| ------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `createDynamicWorkflowRunEntrypoint` | Create a dynamic workflow run entrypoint.               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts#L280) |
| `createWorkflowRunEntrypoint`        | Create a workflow run entrypoint.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts#L207)         |
| `createWorkflowRunManager`           | Create a workflow run manager backed by run executors.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts#L442)            |
| `createWorkflowWorker`               | Create a workflow worker                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts#L341)        |
| `isRunExecutor`                      | Type guard to check if an object implements RunExecutor | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts#L130)        |
| `runDynamicWorkflowRun`              | Run a workflow run with dynamic discovery.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts#L89)  |
| `runWorkflowRun`                     | Run the workflow run entrypoint                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts#L98)          |

#### Classes

| Name                 | Description                | Source                                                                                                        |
| -------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `ProcessRunExecutor` | Process run executor       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/process.ts#L126) |
| `WorkflowRunManager` | Workflow run manager       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts#L126)       |
| `WorkflowWorker`     | Implement workflow worker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts#L103)   |

#### Types

| Name                                        | Description                                                         | Source                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `CreateDynamicWorkflowRunEntrypointOptions` | Create a dynamic workflow run entrypoint.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts#L271) |
| `CreateWorkflowRunEntrypointOptions`        | Create a simple workflow run entrypoint script.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts#L195)         |
| `DynamicWorkflowRunEntrypointConfig`        | Configuration for the dynamic workflow run entrypoint.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts#L70)  |
| `ManagerStats`                              | Manager statistics                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts#L75)             |
| `ManagerStatus`                             | Manager status                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts#L70)             |
| `ProcessRunExecutorConfig`                  | Process run executor configuration                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/process.ts#L67)       |
| `RunExecutionConfig`                        | Run execution configuration passed to executor                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts#L16)         |
| `RunExecutionInfo`                          | Run execution information returned by executor                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts#L44)         |
| `RunExecutionStatus`                        | Run execution status                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts#L39)         |
| `RunExecutor`                               | Run Executor Interface                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts#L91)         |
| `WorkerStats`                               | Worker statistics                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts#L61)         |
| `WorkerStatus`                              | Worker status                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts#L56)         |
| `WorkflowRunEntrypointConfig`               | Configuration for the workflow run entrypoint.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts#L49)          |
| `WorkflowRunManagerConfig`                  | Configuration for the workflow run manager backed by run executors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts#L41)             |
| `WorkflowWorkerConfig`                      | Configuration for the workflow worker                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts#L30)         |
