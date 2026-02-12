---
title: "veryfront/workflow"
description: "DAG-based agentic workflows with human-in-the-loop support."
order: 11
---

DAG-based agentic workflows with human-in-the-loop support.

## Import

```ts
import {
  workflow,
  step,
  parallel,
  branch,
  waitForApproval,
  createWorkflowClient,
} from "veryfront/workflow";
```

## Examples

### Simple sequential workflow

```typescript
import { workflow, step } from "veryfront/workflow";

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
import { workflow, step, parallel, branch, waitForApproval } from "veryfront/workflow";

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

Define workflow with step DAG

| Property | Type | Description |
|----------|------|-------------|
| `id` | `string` | Unique workflow identifier |
| `description?` | `string` | Human-readable description |
| `version?` | `string` | Semantic version string |
| `inputSchema?` | `z.ZodSchema<TInput>` | Zod schema for workflow input validation |
| `outputSchema?` | `z.ZodSchema<TOutput>` | Zod schema for workflow output validation |
| `retry?` | `RetryConfig` | Retry configuration for failed steps |
| `timeout?` | `string \\| number` | Max execution time (ms) |
| `introspect?` | `boolean` | Enable runtime introspection for debugging |
| `steps` | `WorkflowNode[] \\| ((context: StepBuilderContext<TInput>) => WorkflowNode[])` | Workflow step definitions |
| `onError?` | `(error: Error, context: WorkflowContext) => void \\| Promise<void>` | Error handler called when a step fails |
| `onComplete?` | `(result: TOutput, context: WorkflowContext) => void \\| Promise<void>` | Callback fired after workflow completes |

**Returns:** `Workflow<TInput, TOutput>`

## Type Reference

### `StepOptions`

`step()` options

| Property | Type | Description |
|----------|------|-------------|
| `agent?` | `string \\| Agent` | Agent to run (by ID or instance) |
| `tool?` | `string \\| Tool` | Tool to execute (by ID or instance) |
| `input?` | `string \\| Record<string, unknown> \\| ((context: WorkflowContext) => unknown)` | Step input — static value or function of workflow context |
| `checkpoint?` | `boolean` | Persist state after this step |
| `retry?` | `RetryConfig` | Retry configuration for this step |
| `timeout?` | `string \\| number` | Step timeout (ms) |
| `skip?` | `(context: WorkflowContext) => boolean \\| Promise<boolean>` | Predicate — skip this step if returns true |

### `BranchOptions`

`branch()` options

| Property | Type | Description |
|----------|------|-------------|
| `condition` | `(context: WorkflowContext) => boolean \\| Promise<boolean>` | Branch predicate function |
| `then` | `WorkflowNode[]` | Steps when condition is true |
| `else?` | `WorkflowNode[]` | Steps when condition is false |
| `checkpoint?` | `boolean` | Persist state after this node |
| `retry?` | `RetryConfig` | Retry configuration |
| `timeout?` | `string \\| number` | Node timeout (ms or duration string) |
| `skip?` | `(context: WorkflowContext) => boolean \\| Promise<boolean>` | Predicate — skip if returns true |

### `ParallelOptions`

`parallel()` options

| Property | Type | Description |
|----------|------|-------------|
| `strategy?` | `"all" \\| "race" \\| "allSettled"` | Completion strategy (`"all"`, `"race"`, `"allSettled"`) |
| `checkpoint?` | `boolean` | Persist state after this node |
| `retry?` | `RetryConfig` | Retry configuration |
| `timeout?` | `string \\| number` | Node timeout (ms or duration string) |
| `skip?` | `(context: WorkflowContext) => boolean \\| Promise<boolean>` | Predicate — skip if returns true |

## Exports

### Functions

| Name | Description |
|------|-------------|
| `agentStep` | Step that runs an agent |
| `branch` | Create a conditional branch node. |
| `createWorkflowClient` | HTTP client for workflow management |
| `dag` | Define step dependency graph |
| `delay` | Create a simple delay/sleep node. |
| `dependsOn` | Declare step dependencies |
| `doWhile` | Execute once, then repeat while true |
| `generateId` | Generate a unique workflow ID |
| `getWorkflowTenant` | Get the current workflow tenant context. |
| `hasWorkerSupport` | Check worker support |
| `loop` | Repeat while condition holds |
| `map` | Map array items in parallel |
| `parallel` | Create a parallel node for concurrent execution of multiple steps. |
| `parseDuration` | Parse duration string to milliseconds |
| `sequence` | Run steps sequentially |
| `step` | Create workflow step |
| `subWorkflow` | Create a sub-workflow node for nested execution. |
| `times` | Repeat N times |
| `toolStep` | Step that executes a tool |
| `unless` | Create a branch that only executes if condition is false. |
| `useApproval` | Handle workflow approval interactions. |
| `useWorkflow` | Track workflow status and steps |
| `useWorkflowList` | List and filter workflow runs. |
| `useWorkflowStart` | Start workflow from React |
| `waitForApproval` | Create a wait-for-approval node. Pauses until human approves/rejects. |
| `waitForEvent` | Create a wait-for-event node. Pauses until external event is received. |
| `when` | Create a branch that only executes if condition is true (no else). |
| `workflow` | Define workflow with step DAG |

### Classes

| Name | Description |
|------|-------------|
| `MemoryBackend` | In-memory backend (dev) |
| `RedisBackend` | Redis backend (production) |
| `WorkflowClient` | Workflow HTTP client |
| `WorkflowExecutor` | Workflow Executor class |

### Types

| Name | Description |
|------|-------------|
| `BackendConfig` | Backend base config |
| `BranchOptions` | `branch()` options |
| `CapturedTenantContext` | Captured tenant context for multi-tenant workflow execution. |
| `LoopOptions` | `loop()` / `doWhile()` options |
| `MapOptions` | `map()` options |
| `ParallelOptions` | `parallel()` options |
| `RedisAdapter` | Standardized Redis Adapter Interface |
| `RedisBackendConfig` | Redis backend configuration |
| `StepOptions` | `step()` options |
| `SubWorkflowOptions` | `subWorkflow()` options |
| `UseApprovalOptions` | `useApproval` options |
| `UseApprovalResult` | `useApproval` result |
| `UseWorkflowListOptions` | `useWorkflowList` options |
| `UseWorkflowListResult` | `useWorkflowList` result |
| `UseWorkflowOptions` | `useWorkflow` options |
| `UseWorkflowResult` | `useWorkflow` result |
| `UseWorkflowStartOptions` | `useWorkflowStart` options |
| `UseWorkflowStartResult` | `useWorkflowStart` result |
| `WaitForApprovalOptions` | `waitForApproval()` options |
| `WaitForEventOptions` | `waitForEvent()` options |
| `Workflow` | Workflow instance |
| `WorkflowBackend` | State storage backend interface |
| `WorkflowClientConfig` | `createWorkflowClient()` config |
| `WorkflowContext` | Workflow context - accumulates node outputs during execution |
| `WorkflowDefinition` | Workflow definition |
| `WorkflowExecutorConfig` | Workflow executor configuration |
| `WorkflowHandle` | Handle for a running workflow |
| `WorkflowNode` | Workflow node |
| `WorkflowNodeConfig` | Union of all workflow node configurations |
| `WorkflowOptions` | `workflow()` options |
| `WorkflowRun` | Workflow run state |
| `WorkflowStatus` | Status (pending, running, completed, failed) |

### Constants

| Name | Description |
|------|-------------|
| `api` | Context-aware API that automatically uses the current tenant. |

## Related

- [`veryfront/agent`](./agent.md) — Agent steps in workflows
- [`veryfront/tool`](./tool.md) — Tool steps in workflows
