---
title: "veryfront/workflow"
description: "DAG-based agentic workflows with human-in-the-loop support."
order: 38
---

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

Create a workflow definition.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `id` | `string` | Unique workflow identifier | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L23) |
| `description?` | `string` | Human-readable description | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L24) |
| `version?` | `string` | Semantic version string | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L25) |
| `inputSchema?` | <code>Schema&lt;TInput&gt;</code> | Zod schema for workflow input validation | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L26) |
| `outputSchema?` | <code>Schema&lt;TOutput&gt;</code> | Zod schema for workflow output validation | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L27) |
| `retry?` | `RetryConfig` | Retry configuration for failed steps | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L28) |
| `timeout?` | `string \| number` | Max execution time (ms) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L29) |
| `introspect?` | `boolean` | Enable runtime introspection for debugging | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L30) |
| `steps` | <code>WorkflowNode[] &#124; ((context: StepBuilderContext&lt;TInput&gt;) =&gt; WorkflowNode[])</code> | Workflow step definitions | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L31) |
| `onError?` | <code>(error: Error, context: WorkflowContext) =&gt; void &#124; Promise&lt;void&gt;</code> | Error handler called when a step fails | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L34) |
| `onComplete?` | <code>(result: TOutput, context: WorkflowContext) =&gt; void &#124; Promise&lt;void&gt;</code> | Callback fired after workflow completes | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L35) |

**Returns:** <code>Workflow&lt;TInput, TOutput&gt;</code>

## Type Reference

### `StepOptions`

Options accepted by step.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `agent?` | `string \| Agent` | Agent to run (by ID or instance) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L15) |
| `tool?` | `string \| Tool` | Tool to execute (by ID or instance) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L16) |
| `input?` | <code>string &#124; Record&lt;string, unknown&gt; &#124; ((context: WorkflowContext) =&gt; unknown)</code> | Step input: static value or function of workflow context | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L17) |
| `checkpoint?` | `boolean` | Persist state after this step | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L18) |
| `retry?` | `RetryConfig` | Retry configuration for this step | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L19) |
| `timeout?` | `string \| number` | Step timeout (ms) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L20) |
| `skip?` | <code>(context: WorkflowContext) =&gt; boolean &#124; Promise&lt;boolean&gt;</code> | Predicate: skip this step if returns true | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L21) |

### `BranchOptions`

Options accepted by branch.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `condition` | <code>(context: WorkflowContext) =&gt; boolean &#124; Promise&lt;boolean&gt;</code> | Branch predicate function | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L13) |
| `then` | `WorkflowNode[]` | Steps when condition is true | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L14) |
| `else?` | `WorkflowNode[]` | Steps when condition is false | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L15) |
| `checkpoint?` | `boolean` | Persist state after this node | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L16) |
| `retry?` | `RetryConfig` | Retry configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L17) |
| `timeout?` | `string \| number` | Node timeout (ms or duration string) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L18) |
| `skip?` | <code>(context: WorkflowContext) =&gt; boolean &#124; Promise&lt;boolean&gt;</code> | Predicate: skip if returns true | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L19) |

### `ParallelOptions`

Options accepted by parallel.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `strategy?` | `"all" \| "race" \| "allSettled"` | Completion strategy (`"all"`, `"race"`, `"allSettled"`) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts#L13) |
| `checkpoint?` | `boolean` | Persist state after this node | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts#L14) |
| `retry?` | `RetryConfig` | Retry configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts#L15) |
| `timeout?` | `string \| number` | Node timeout (ms or duration string) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts#L16) |
| `skip?` | <code>(context: WorkflowContext) =&gt; boolean &#124; Promise&lt;boolean&gt;</code> | Predicate: skip if returns true | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts#L17) |

## Exports

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `agentStep` | Create a workflow step that runs an agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L56) |
| `branch` | Create a conditional branch node. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L32) |
| `createWorkflowClient` | Create workflow client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api/workflow-client.ts#L183) |
| `dag` | Create a directed workflow graph. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L92) |
| `delay` | Create a simple delay/sleep node. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts#L66) |
| `dependsOn` | Declare workflow step dependencies. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L119) |
| `doWhile` | Create a do-while workflow loop. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/loop.ts#L103) |
| `generateId` | Generate a unique workflow ID | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L362) |
| `getWorkflowTenant` | Get the current workflow tenant context. Returns undefined if not executing within a workflow step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/executor/step-executor.ts#L45) |
| `hasWorkerSupport` | Check whether worker support is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L262) |
| `loop` | Create a loop workflow step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/loop.ts#L56) |
| `map` | Create a mapped workflow step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/map.ts#L24) |
| `parallel` | Create a parallel node for concurrent execution of multiple steps. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts#L21) |
| `parseDuration` | Parse duration string to milliseconds | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L288) |
| `sequence` | Create a sequential workflow definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L78) |
| `step` | Create a workflow step definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L25) |
| `subWorkflow` | Create a sub-workflow node for nested execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/sub-workflow.ts#L19) |
| `times` | Create a fixed-count workflow loop. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/loop.ts#L121) |
| `toolStep` | Create a workflow step that runs a tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L65) |
| `unless` | Create a branch that only executes if condition is false. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L66) |
| `useApproval` | Manage workflow approval interactions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-approval.ts#L29) |
| `useWorkflow` | React hook for workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow.ts#L41) |
| `useWorkflowList` | List and filter workflow runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-list.ts#L36) |
| `useWorkflowStart` | React hook for workflow start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-start.ts#L22) |
| `waitForApproval` | Create a wait-for-approval node. Pauses until human approves/rejects. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts#L16) |
| `waitForEvent` | Create a wait-for-event node. Pauses until external event is received. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts#L44) |
| `when` | Create a branch that only executes if condition is true (no else). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L57) |
| `workflow` | Create a workflow definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L42) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `MemoryBackend` | Implement memory backend. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/memory.ts#L41) |
| `RedisBackend` | Implement redis backend. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/redis/index.ts#L221) |
| `WorkflowClient` | Implement workflow client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api/workflow-client.ts#L40) |
| `WorkflowExecutor` | Workflow Executor class | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/executor/workflow-executor.ts#L114) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `BackendConfig` | Configuration used by backend. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L57) |
| `BranchOptions` | Options accepted by branch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L12) |
| `CapturedTenantContext` | Captured tenant context for multi-tenant workflow execution. Allows tools and framework utilities to access the current tenant without explicit parameter passing. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L235) |
| `LoopOptions` | Options accepted by loop. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/loop.ts#L20) |
| `MapOptions` | Options accepted by map. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/map.ts#L13) |
| `ParallelOptions` | Options accepted by parallel. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts#L12) |
| `RedisAdapter` | Standardized Redis Adapter Interface Normalizes differences between Deno and Node Redis clients | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/redis/interface.ts#L5) |
| `RedisBackendConfig` | Redis backend configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/redis/types.ts#L22) |
| `StepOptions` | Options accepted by step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L14) |
| `SubWorkflowOptions` | Options accepted by sub workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/sub-workflow.ts#L12) |
| `UseApprovalOptions` | Options accepted by use approval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-approval.ts#L6) |
| `UseApprovalResult` | Result returned from use approval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-approval.ts#L16) |
| `UseWorkflowListOptions` | Options accepted by use workflow list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-list.ts#L9) |
| `UseWorkflowListResult` | Result returned from use workflow list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-list.ts#L21) |
| `UseWorkflowOptions` | Options accepted by use workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow.ts#L14) |
| `UseWorkflowResult` | Result returned from use workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow.ts#L26) |
| `UseWorkflowStartOptions` | Options accepted by use workflow start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-start.ts#L5) |
| `UseWorkflowStartResult` | Result returned from use workflow start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/react/use-workflow-start.ts#L13) |
| `WaitForApprovalOptions` | Options accepted by wait for approval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts#L6) |
| `WaitForEventOptions` | Options accepted by wait for event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts#L36) |
| `Workflow` | Workflow instance | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L224) |
| `WorkflowBackend` | Public API contract for workflow backend. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L72) |
| `WorkflowClientConfig` | Configuration used by workflow client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api/workflow-client.ts#L28) |
| `WorkflowContext` | Workflow context containing structured-cloneable input and node outputs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L50) |
| `WorkflowDefinition` | Workflow definition | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L207) |
| `WorkflowExecutorConfig` | Workflow executor configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/executor/workflow-executor.ts#L60) |
| `WorkflowHandle` | Controller for a running workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/executor/workflow-executor.ts#L92) |
| `WorkflowNode` | Workflow node | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L198) |
| `WorkflowNodeConfig` | Union of all workflow node configurations | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L186) |
| `WorkflowOptions` | Options accepted by workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L22) |
| `WorkflowRun` | Workflow run state | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L255) |
| `WorkflowRunUpdate` | Run state that may change after the immutable run snapshot is created. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L13) |
| `WorkflowStatus` | Public API contract for workflow status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/schemas/workflow.schema.ts#L250) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `api` | Context-aware API that automatically uses the current tenant. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api.ts#L114) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/workflow/claude-code`

Claude Agent SDK Integration Provides Claude Code agentic capabilities within Veryfront workflows. Uses your local Claude Code installation - no separate API key needed.

```ts
import { createAgent, createClaudeCodeTool, createEventPublisher } from "veryfront/workflow/claude-code";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createAgent` | Create a reusable agent function with preset configuration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/agent.ts#L257) |
| `createClaudeCodeTool` | Create a customized Claude Code tool | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L113) |
| `createEventPublisher` | Create an event publisher based on environment | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L312) |
| `createWebSocketHandler` | Create a WebSocket handler for HTTP upgrade requests | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L261) |
| `createWorkspaceSync` | Create a workspace sync for a Claude Code run | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L642) |
| `executeAgent` | Execute a task using the Claude Agent SDK. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/agent.ts#L108) |
| `withWorkspace` | Execute a function with a synchronized workspace | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L667) |

#### Classes

| Name | Description | Source |
|------|-------------|--------|
| `AgentController` | Agent controller for handling client commands | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L308) |
| `CallbackEventPublisher` | Simple callback-based publisher Calls a function for each event | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L259) |
| `MemoryEventPublisher` | In-memory event publisher using EventTarget Useful for testing or single-process deployments | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L26) |
| `MultiEventPublisher` | Publishes events to multiple publishers | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L278) |
| `RedisEventPublisher` | Implement redis event publisher. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L103) |
| `SSEEventPublisher` | Server-Sent Events publisher Writes events directly to a ReadableStream controller | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L215) |
| `WebSocketPublisher` | WebSocket-based bidirectional publisher | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L54) |
| `WorkspaceSync` | Workspace manager for Claude Code execution | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L169) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `AgentConfig` | Agent configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/agent.ts#L20) |
| `ApprovalRequestEvent` | Approval request event (sent to client when tool needs approval) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L359) |
| `BidirectionalPublisher` | Bidirectional publisher interface (WebSocket) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L406) |
| `CancelCommand` | Cancel the running agent | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L284) |
| `CancelledEvent` | Cancelled event | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L388) |
| `ClaudeCodeEvent` | Union of all event types | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L220) |
| `ClaudeCodeEventBase` | Base event interface | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L91) |
| `ClaudeCodeEventHandler` | Event subscriber callback | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L248) |
| `ClaudeCodeEventPublisher` | Event publisher interface for streaming events | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L238) |
| `ClaudeCodeEventSubscriber` | Event subscriber interface for receiving events | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L253) |
| `ClaudeCodeEventType` | Event types for streaming Claude Code execution | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L73) |
| `ClaudeCodeMode` | Tool modes for Claude Code agent | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L10) |
| `ClaudeCodeResult` | Final result from agent execution | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L28) |
| `ClaudeCodeToolInput` | Input schema type for claude-code workflow tools | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L50) |
| `ClientCommand` | Union of all client commands | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L324) |
| `ClientCommandHandler` | Handler for client commands | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L334) |
| `ClientCommandType` | Client command types for WebSocket communication | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L265) |
| `CompleteEvent` | Complete event (agent finished) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L202) |
| `ErrorEvent` | Error event | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L210) |
| `FileChange` | File change tracking | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L54) |
| `InputCommand` | Send user input to the agent | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L309) |
| `InputRequestEvent` | Input request event (sent to client when agent needs user input) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L371) |
| `IterationCompleteEvent` | Iteration complete event | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L169) |
| `IterationStartEvent` | Iteration start event | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L105) |
| `PingCommand` | Keepalive ping | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L317) |
| `PongEvent` | Pong response to ping | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L381) |
| `RedisEventPublisherConfig` | Redis event publisher configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L78) |
| `TextCompleteEvent` | Text complete event | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L122) |
| `TextDeltaEvent` | Text delta event (streaming text chunk) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L114) |
| `ThinkingCompleteEvent` | Thinking complete event | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L194) |
| `ThinkingDeltaEvent` | Thinking delta event | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L186) |
| `ThinkingStartEvent` | Thinking start event (extended thinking) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L179) |
| `ToolApprovalConfig` | Tool approval configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L416) |
| `ToolCallCompleteEvent` | Tool call complete event | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L148) |
| `ToolCallInputEvent` | Tool call input delta (streaming input JSON) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L139) |
| `ToolCallStartEvent` | Tool call start event | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L130) |
| `ToolResultEvent` | Tool result event | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L158) |
| `UploadResult` | Upload result | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L91) |
| `WebSocketPublisherConfig` | WebSocket publisher configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L33) |
| `WorkspaceConfig` | Workspace configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L28) |
| `WorkspaceSyncResult` | Workspace sync result | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L64) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `bugFixTool` | Bug fix tool (code mode) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L165) |
| `claudeCodeTool` | Claude Code tool for workflow steps | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L79) |
| `codeReviewTool` | Code review tool (analysis mode, read-only) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L149) |
| `docsTool` | Documentation tool (code mode) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L197) |
| `refactorTool` | Refactoring tool (code mode) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L181) |

### `veryfront/workflow/claude-code/react`

React hooks for Claude Code streaming

```ts
import { useClaudeCodeStream, useClaudeCodeText, useClaudeCodeWebSocket } from "veryfront/workflow/claude-code/react";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `useClaudeCodeStream` | React hook for streaming Claude Code execution | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-stream.ts#L108) |
| `useClaudeCodeText` | Simplified hook that returns just the streaming text | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-stream.ts#L250) |
| `useClaudeCodeWebSocket` | React hook for bidirectional Claude Code streaming | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts#L165) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `PendingApproval` | Pending approval state | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts#L32) |
| `PendingInput` | Pending input request state | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts#L44) |
| `UseClaudeCodeStreamOptions` | Options for useClaudeCodeStream hook | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-stream.ts#L40) |
| `UseClaudeCodeStreamState` | State for Claude Code streaming | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-stream.ts#L26) |
| `UseClaudeCodeWebSocketActions` | Actions returned by the hook | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts#L106) |
| `UseClaudeCodeWebSocketOptions` | Options for useClaudeCodeWebSocket hook | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts#L71) |
| `UseClaudeCodeWebSocketState` | State for Claude Code WebSocket | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/react/use-claude-code-websocket.ts#L54) |

### `veryfront/workflow/discovery`

Workflow Discovery Module Provides utilities for discovering workflow definitions from user code.

```ts
import { createWorkflowRegistry, discoverWorkflows, findWorkflowById } from "veryfront/workflow/discovery";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createWorkflowRegistry` | Create a workflow registry from discovered workflows | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L230) |
| `discoverWorkflows` | Discover all workflows in a project | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L121) |
| `findWorkflowById` | Find a specific workflow by ID | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L219) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `DiscoveredWorkflow` | Discovered workflow info | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L38) |
| `WorkflowDiscoveryOptions` | Options for workflow discovery | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L55) |
| `WorkflowDiscoveryResult` | Result of workflow discovery | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L75) |

### `veryfront/workflow/worker`

Workflow worker module Provides distributed workflow execution support. Two execution profiles are available: 1. **WorkflowWorker** - In-process polling worker - Polls for stalled workflows and resumes them - Good for trusted code or single-tenant deployments - Simple setup, lower overhead 2. **WorkflowRunManager + ProcessRunExecutor** - Local process execution - Spawns child processes for each workflow - Good for local development without K8s/Docker A workflow run can be backed by a run executor without introducing another user-visible execution type.

```ts
import { createDynamicWorkflowRunEntrypoint, createWorkflowRunEntrypoint, createWorkflowRunManager } from "veryfront/workflow/worker";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `DYNAMIC_EXIT_CODES` | Exit codes for the dynamic workflow run entrypoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts#L59) |
| `EXIT_CODES` | Exit codes for the workflow run entrypoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts#L63) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createDynamicWorkflowRunEntrypoint` | Create a dynamic workflow run entrypoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts#L275) |
| `createWorkflowRunEntrypoint` | Create a workflow run entrypoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts#L203) |
| `createWorkflowRunManager` | Create a workflow run manager backed by run executors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts#L549) |
| `createWorkflowWorker` | Create a workflow worker | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts#L348) |
| `isRunExecutor` | Type guard to check if an object implements RunExecutor | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts#L130) |
| `runDynamicWorkflowRun` | Run a workflow run with dynamic discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts#L89) |
| `runWorkflowRun` | Run the workflow run entrypoint | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts#L98) |

#### Classes

| Name | Description | Source |
|------|-------------|--------|
| `ProcessRunExecutor` | Process run executor | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/process.ts#L126) |
| `WorkflowRunManager` | Workflow run manager | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts#L134) |
| `WorkflowWorker` | Implement workflow worker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts#L103) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `CreateDynamicWorkflowRunEntrypointOptions` | Create a dynamic workflow run entrypoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts#L266) |
| `CreateWorkflowRunEntrypointOptions` | Create a simple workflow run entrypoint script. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts#L191) |
| `DynamicWorkflowRunEntrypointConfig` | Configuration for the dynamic workflow run entrypoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts#L70) |
| `ManagerStats` | Manager statistics | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts#L83) |
| `ManagerStatus` | Manager status | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts#L78) |
| `ProcessRunExecutorConfig` | Process run executor configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/process.ts#L67) |
| `RunExecutionConfig` | Run execution configuration passed to executor | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts#L16) |
| `RunExecutionInfo` | Run execution information returned by executor | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts#L44) |
| `RunExecutionStatus` | Run execution status | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts#L39) |
| `RunExecutor` | Run Executor Interface | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts#L91) |
| `WorkerStats` | Worker statistics | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts#L61) |
| `WorkerStatus` | Worker status | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts#L56) |
| `WorkflowRunEntrypointConfig` | Configuration for the workflow run entrypoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts#L49) |
| `WorkflowRunManagerConfig` | Configuration for the workflow run manager backed by run executors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts#L49) |
| `WorkflowWorkerConfig` | Configuration for the workflow worker | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts#L30) |
