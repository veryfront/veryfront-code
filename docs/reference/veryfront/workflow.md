---
title: "veryfront/workflow"
description: "DAG-based agentic workflows with human-in-the-loop support."
order: 11
---

# veryfront/workflow

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
| `inputSchema?` | <code>Schema&lt;TInput&gt;</code> | Zod schema for workflow input validation |
| `outputSchema?` | <code>Schema&lt;TOutput&gt;</code> | Zod schema for workflow output validation |
| `retry?` | `RetryConfig` | Retry configuration for failed steps |
| `timeout?` | `string \| number` | Max execution time (ms) |
| `introspect?` | `boolean` | Enable runtime introspection for debugging |
| `steps` | <code>WorkflowNode[] &#124; ((context: StepBuilderContext&lt;TInput&gt;) =&gt; WorkflowNode[])</code> | Workflow step definitions |
| `onError?` | <code>(error: Error, context: WorkflowContext) =&gt; void &#124; Promise&lt;void&gt;</code> | Error handler called when a step fails |
| `onComplete?` | <code>(result: TOutput, context: WorkflowContext) =&gt; void &#124; Promise&lt;void&gt;</code> | Callback fired after workflow completes |

**Returns:** <code>Workflow&lt;TInput, TOutput&gt;</code>

## Type Reference

### `StepOptions`

`step()` options

| Property | Type | Description |
|----------|------|-------------|
| `agent?` | `string \| Agent` | Agent to run (by ID or instance) |
| `tool?` | `string \| Tool` | Tool to execute (by ID or instance) |
| `input?` | <code>string &#124; Record&lt;string, unknown&gt; &#124; ((context: WorkflowContext) =&gt; unknown)</code> | Step input: static value or function of workflow context |
| `checkpoint?` | `boolean` | Persist state after this step |
| `retry?` | `RetryConfig` | Retry configuration for this step |
| `timeout?` | `string \| number` | Step timeout (ms) |
| `skip?` | <code>(context: WorkflowContext) =&gt; boolean &#124; Promise&lt;boolean&gt;</code> | Predicate: skip this step if returns true |

### `BranchOptions`

`branch()` options

| Property | Type | Description |
|----------|------|-------------|
| `condition` | <code>(context: WorkflowContext) =&gt; boolean &#124; Promise&lt;boolean&gt;</code> | Branch predicate function |
| `then` | `WorkflowNode[]` | Steps when condition is true |
| `else?` | `WorkflowNode[]` | Steps when condition is false |
| `checkpoint?` | `boolean` | Persist state after this node |
| `retry?` | `RetryConfig` | Retry configuration |
| `timeout?` | `string \| number` | Node timeout (ms or duration string) |
| `skip?` | <code>(context: WorkflowContext) =&gt; boolean &#124; Promise&lt;boolean&gt;</code> | Predicate: skip if returns true |

### `ParallelOptions`

`parallel()` options

| Property | Type | Description |
|----------|------|-------------|
| `strategy?` | `"all" \| "race" \| "allSettled"` | Completion strategy (`"all"`, `"race"`, `"allSettled"`) |
| `checkpoint?` | `boolean` | Persist state after this node |
| `retry?` | `RetryConfig` | Retry configuration |
| `timeout?` | `string \| number` | Node timeout (ms or duration string) |
| `skip?` | <code>(context: WorkflowContext) =&gt; boolean &#124; Promise&lt;boolean&gt;</code> | Predicate: skip if returns true |

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

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/workflow/claude-code`

Claude Agent SDK Integration Provides Claude Code agentic capabilities within Veryfront workflows. Uses your local Claude Code installation — no separate API key needed.

```ts
import { createAgent, createClaudeCodeTool, createEventPublisher } from "veryfront/workflow/claude-code";
```

#### Functions

| Name | Description |
|------|-------------|
| `createAgent` | Create a reusable agent function with preset configuration. |
| `createClaudeCodeTool` | Create a customized Claude Code tool |
| `createEventPublisher` | Create an event publisher based on environment |
| `createWebSocketHandler` | Create a WebSocket handler for HTTP upgrade requests |
| `createWorkspaceSync` | Create a workspace sync for a Claude Code run |
| `executeAgent` | Execute a task using the Claude Agent SDK. |
| `withWorkspace` | Execute a function with a synchronized workspace |

#### Classes

| Name | Description |
|------|-------------|
| `AgentController` | Agent controller for handling client commands |
| `CallbackEventPublisher` | Simple callback-based publisher |
| `MemoryEventPublisher` | In-memory event publisher using EventTarget |
| `MultiEventPublisher` | Publishes events to multiple publishers |
| `RedisEventPublisher` |  |
| `SSEEventPublisher` | Server-Sent Events publisher |
| `WebSocketPublisher` | WebSocket-based bidirectional publisher |
| `WorkspaceSync` | Workspace manager for Claude Code execution |

#### Types

| Name | Description |
|------|-------------|
| `AgentConfig` | Agent configuration |
| `ApprovalRequestEvent` | Approval request event (sent to client when tool needs approval) |
| `BidirectionalPublisher` | Bidirectional publisher interface (WebSocket) |
| `CancelCommand` | Cancel the running agent |
| `CancelledEvent` | Cancelled event |
| `ClaudeCodeEvent` | Union of all event types |
| `ClaudeCodeEventBase` | Base event interface |
| `ClaudeCodeEventHandler` | Event subscriber callback |
| `ClaudeCodeEventPublisher` | Event publisher interface for streaming events |
| `ClaudeCodeEventSubscriber` | Event subscriber interface for receiving events |
| `ClaudeCodeEventType` | Event types for streaming Claude Code execution |
| `ClaudeCodeMode` | Tool modes for Claude Code agent |
| `ClaudeCodeResult` | Final result from agent execution |
| `ClaudeCodeToolInput` | Input schema type for claude-code workflow tools |
| `ClientCommand` | Union of all client commands |
| `ClientCommandHandler` | Handler for client commands |
| `ClientCommandType` | Client command types for WebSocket communication |
| `CompleteEvent` | Complete event (agent finished) |
| `ErrorEvent` | Error event |
| `FileChange` | File change tracking |
| `InputCommand` | Send user input to the agent |
| `InputRequestEvent` | Input request event (sent to client when agent needs user input) |
| `IterationCompleteEvent` | Iteration complete event |
| `IterationStartEvent` | Iteration start event |
| `PingCommand` | Keepalive ping |
| `PongEvent` | Pong response to ping |
| `RedisEventPublisherConfig` | Redis event publisher configuration |
| `TextCompleteEvent` | Text complete event |
| `TextDeltaEvent` | Text delta event (streaming text chunk) |
| `ThinkingCompleteEvent` | Thinking complete event |
| `ThinkingDeltaEvent` | Thinking delta event |
| `ThinkingStartEvent` | Thinking start event (extended thinking) |
| `ToolApprovalConfig` | Tool approval configuration |
| `ToolCallCompleteEvent` | Tool call complete event |
| `ToolCallInputEvent` | Tool call input delta (streaming input JSON) |
| `ToolCallStartEvent` | Tool call start event |
| `ToolResultEvent` | Tool result event |
| `UploadResult` | Upload result |
| `WebSocketPublisherConfig` | WebSocket publisher configuration |
| `WorkspaceConfig` | Workspace configuration |
| `WorkspaceSyncResult` | Workspace sync result |

#### Constants

| Name | Description |
|------|-------------|
| `bugFixTool` | Bug fix tool (code mode) |
| `claudeCodeTool` | Claude Code tool for workflow steps |
| `codeReviewTool` | Code review tool (analysis mode, read-only) |
| `docsTool` | Documentation tool (code mode) |
| `refactorTool` | Refactoring tool (code mode) |

### `veryfront/workflow/claude-code/react`

React hooks for Claude Code streaming

```ts
import { useClaudeCodeStream, useClaudeCodeText, useClaudeCodeWebSocket } from "veryfront/workflow/claude-code/react";
```

#### Functions

| Name | Description |
|------|-------------|
| `useClaudeCodeStream` | React hook for streaming Claude Code execution |
| `useClaudeCodeText` | Simplified hook that returns just the streaming text |
| `useClaudeCodeWebSocket` | React hook for bidirectional Claude Code streaming |

#### Types

| Name | Description |
|------|-------------|
| `PendingApproval` | Pending approval state |
| `PendingInput` | Pending input request state |
| `UseClaudeCodeStreamOptions` | Options for useClaudeCodeStream hook |
| `UseClaudeCodeStreamState` | State for Claude Code streaming |
| `UseClaudeCodeWebSocketActions` | Actions returned by the hook |
| `UseClaudeCodeWebSocketOptions` | Options for useClaudeCodeWebSocket hook |
| `UseClaudeCodeWebSocketState` | State for Claude Code WebSocket |

### `veryfront/workflow/discovery`

Workflow Discovery Module Provides utilities for discovering workflow definitions from user code.

```ts
import { createWorkflowRegistry, discoverWorkflows, findWorkflowById } from "veryfront/workflow/discovery";
```

#### Functions

| Name | Description |
|------|-------------|
| `createWorkflowRegistry` | Create a workflow registry from discovered workflows |
| `discoverWorkflows` | Discover all workflows in a project |
| `findWorkflowById` | Find a specific workflow by ID |

#### Types

| Name | Description |
|------|-------------|
| `DiscoveredWorkflow` | Discovered workflow info |
| `WorkflowDiscoveryOptions` | Options for workflow discovery |
| `WorkflowDiscoveryResult` | Result of workflow discovery |

### `veryfront/workflow/worker`

Workflow Worker Module Provides distributed workflow execution support. Three modes available: 1. **WorkflowWorker** - In-process polling worker - Polls for stalled workflows and resumes them - Good for trusted code or single-tenant deployments - Simple setup, lower overhead 2. **WorkflowJobManager + K8sJobExecutor** - Kubernetes Job-based execution - Each workflow runs in an ephemeral container - Complete tenant isolation (no shared state) - Required for multi-tenant untrusted code execution 3. **WorkflowJobManager + ProcessJobExecutor** - Local process execution - Spawns child processes for each workflow - Good for local development without K8s/Docker - Mirrors production behavior

```ts
import { createDynamicJobEntrypoint, createJobEntrypoint, createWorkflowJobManager } from "veryfront/workflow/worker";
```

#### Components

| Name | Description |
|------|-------------|
| `DYNAMIC_EXIT_CODES` | Exit codes for the job |
| `EXIT_CODES` | Exit codes for the job |

#### Functions

| Name | Description |
|------|-------------|
| `createDynamicJobEntrypoint` |  |
| `createJobEntrypoint` |  |
| `createWorkflowJobManager` | Create a workflow job manager |
| `createWorkflowWorker` | Create a workflow worker |
| `isJobExecutor` | Type guard to check if an object implements JobExecutor |
| `runDynamicWorkflowJob` | Run a workflow job with dynamic discovery |
| `runWorkflowJob` | Run the workflow job |

#### Classes

| Name | Description |
|------|-------------|
| `K8sJobExecutor` | Kubernetes Job Executor |
| `ProcessJobExecutor` | Process Job Executor |
| `WorkflowJobManager` | Workflow Job Manager |
| `WorkflowWorker` |  |

#### Types

| Name | Description |
|------|-------------|
| `CreateDynamicJobEntrypointOptions` | Create a dynamic job entrypoint |
| `CreateJobEntrypointOptions` | Create a simple job entrypoint script |
| `DynamicJobEntrypointConfig` | Configuration for the dynamic job entrypoint |
| `JobConfig` | Job configuration passed to executor |
| `JobEntrypointConfig` | Configuration for the job entrypoint |
| `JobExecutor` | Job Executor Interface |
| `JobInfo` | Job information returned by executor |
| `JobStatus` | Job execution status |
| `K8sClient` | Kubernetes API client interface |
| `K8sJobExecutorConfig` | K8s Job Executor configuration |
| `K8sJobSpec` | K8s Job spec |
| `K8sJobStatusResponse` | K8s Job status response |
| `ManagerStats` | Manager statistics |
| `ManagerStatus` | Manager status |
| `ProcessJobExecutorConfig` | Process Job Executor configuration |
| `WorkerStats` | Worker statistics |
| `WorkerStatus` | Worker status |
| `WorkflowJobManagerConfig` | Configuration for the Workflow Job Manager |
| `WorkflowWorkerConfig` | Configuration for the workflow worker |

## Related

Reference modules:

- [`veryfront/agent`](./agent.md): Agent steps in workflows
- [`veryfront/tool`](./tool.md): Tool steps in workflows

User guides:

- [workflows](../../guides/workflows.md): Author durable workflows
- [multi-agent](../../guides/multi-agent.md): Orchestrate multi-agent workflows

Architecture:

- [05-workflow-runtime](../../architecture/05-workflow-runtime.md): Workflow runtime architecture
- [20-jobs-and-tasks](../../architecture/20-jobs-and-tasks.md): Workflows, jobs, and tasks
