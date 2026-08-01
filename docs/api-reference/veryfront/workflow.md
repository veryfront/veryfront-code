---
title: "veryfront/workflow"
description: "DAG-based agentic workflows with human-in-the-loop support."
order: 42
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
| `version?` | `string` | Required for a persisted run to be safely resumed after its initial start admission. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L26) |
| `inputSchema?` | <code>Schema&lt;TInput&gt;</code> | Zod schema for workflow input validation | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L27) |
| `outputSchema?` | <code>Schema&lt;TOutput&gt;</code> | Zod schema for workflow output validation | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L28) |
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
| `agentStep` | Create a workflow step that runs an agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L57) |
| `branch` | Create a conditional branch node. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L27) |
| `captureApprovalDecisionTiming` | Validate and detach caller-owned approval decision timing. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L166) |
| `createDistributedWorkflowBackend` | Create a workflow backend from an already-activated distributed provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/distributed.ts#L236) |
| `createDistributedWorkflowWorkerResources` | Create a backend and its provider-owned isolated-process environment. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/distributed.ts#L250) |
| `createWorkflowClient` | Create workflow client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api/workflow-client.ts#L635) |
| `dag` | Create a directed workflow graph. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L92) |
| `delay` | Create a simple delay/sleep node. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts#L84) |
| `dependsOn` | Declare workflow step dependencies. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L119) |
| `doWhile` | Create a do-while workflow loop. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/loop.ts#L126) |
| `generateId` | Generate a unique workflow ID | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L614) |
| `getWorkflowTenant` | Get the current workflow tenant context. Returns undefined if not executing within a workflow step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/executor/step-executor.ts#L64) |
| `hasWorkerSupport` | Check whether worker support is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L616) |
| `loop` | Create a loop workflow step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/loop.ts#L61) |
| `map` | Create a mapped workflow step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/map.ts#L28) |
| `parallel` | Create a parallel node for concurrent execution of multiple steps. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts#L21) |
| `parseDuration` | Parse duration string to milliseconds | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L460) |
| `sequence` | Create a sequential workflow definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L78) |
| `step` | Create a workflow step definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L25) |
| `subWorkflow` | Create a sub-workflow node for nested execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/sub-workflow.ts#L19) |
| `times` | Create a fixed-count workflow loop. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/loop.ts#L144) |
| `toolStep` | Create a workflow step that runs a tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L66) |
| `unless` | Create a branch that only executes if condition is false. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L62) |
| `waitForApproval` | Create a wait-for-approval node. Pauses until human approves/rejects. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts#L28) |
| `waitForEvent` | Create a wait-for-event node. Pauses until external event is received. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts#L60) |
| `when` | Create a branch that only executes if condition is true (no else). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L53) |
| `workflow` | Create a workflow definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L42) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `MemoryBackend` | Implement memory backend. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/memory.ts#L139) |
| `WorkflowClient` | Implement workflow client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api/workflow-client.ts#L185) |
| `WorkflowExecutor` | Workflow Executor class | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/executor/workflow-executor.ts#L352) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `ApprovalDecisionTiming` | Canonical time and expiry predicate for one approval decision attempt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L160) |
| `ApprovalExpiryCondition` | Expiry predicate evaluated in the same transaction as an approval decision. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L151) |
| `BackendConfig` | Configuration used by backend. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L131) |
| `BranchOptions` | Options accepted by branch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/branch.ts#L12) |
| `CapturedTenantContext` | Captured tenant context for multi-tenant workflow execution. Allows tools and framework utilities to access the current tenant without explicit parameter passing. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L311) |
| `DistributedWorkflowBackendOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L65) |
| `DistributedWorkflowWorkerEnvironment` | Provider-owned environment required by an isolated workflow worker process. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L75) |
| `DistributedWorkflowWorkerResources` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/distributed.ts#L244) |
| `LoopOptions` | Options accepted by loop. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/loop.ts#L25) |
| `MapOptions` | Options accepted by map. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/map.ts#L17) |
| `ParallelOptions` | Options accepted by parallel. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/parallel.ts#L12) |
| `PendingApprovalMetadataUpdate` | Metadata that may be attached without changing an approval decision. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L146) |
| `StepOptions` | Options accepted by step. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/step.ts#L14) |
| `SubWorkflowOptions` | Options accepted by sub workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/sub-workflow.ts#L12) |
| `WaitForApprovalOptions` | Options accepted by wait for approval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts#L18) |
| `WaitForEventOptions` | Options accepted by wait for event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/wait.ts#L52) |
| `Workflow` | Workflow instance | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L300) |
| `WorkflowBackend` | Public API contract for workflow backend. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L264) |
| `WorkflowBackendOwnership` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api/workflow-client.ts#L45) |
| `WorkflowClientConfig` | Configuration used by workflow client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api/workflow-client.ts#L171) |
| `WorkflowContext` | Workflow context containing structured-cloneable input and node outputs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L54) |
| `WorkflowDefinition` | Workflow definition | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L283) |
| `WorkflowExecutorConfig` | Workflow executor configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/executor/workflow-executor.ts#L130) |
| `WorkflowHandle` | Controller for a running workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/executor/workflow-executor.ts#L162) |
| `WorkflowNode` | Workflow node | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L274) |
| `WorkflowNodeConfig` | Union of all workflow node configurations | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L262) |
| `WorkflowOptions` | Options accepted by workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/dsl/workflow.ts#L22) |
| `WorkflowRun` | Workflow run state | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/types.ts#L331) |
| `WorkflowRunUpdate` | Run state that may change after the immutable run snapshot is created. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/backends/types.ts#L62) |
| `WorkflowStatus` | Public API contract for workflow status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/schemas/workflow.schema.ts#L266) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `api` | Context-aware API that automatically uses the current tenant. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/api.ts#L121) |

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/workflow/blob`

Provider-neutral blob storage contracts and built-in first-party storage.

```ts
import { assertSafeBlobId, isSafeBlobId, BlobStorageContractName } from "veryfront/workflow/blob";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `BlobStorageContractName` | Extension contract name for an explicitly selected blob-storage implementation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/types.ts#L38) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `assertSafeBlobId` | Validate an identifier before any blob backend constructs a storage path. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/blob-id.ts#L15) |
| `isSafeBlobId` | Return whether a runtime value is a framework-safe blob identifier. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/blob-id.ts#L9) |

#### Classes

| Name | Description | Source |
|------|-------------|--------|
| `LocalBlobStorage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/local-storage.ts#L159) |
| `VeryfrontCloudBlobStorage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/veryfront-cloud-storage.ts#L305) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `BlobRef` | Blob Storage Types | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/types.ts#L7) |
| `BlobStorage` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/types.ts#L40) |
| `StoreBlobOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/types.ts#L26) |
| `VeryfrontCloudBlobStorageConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/veryfront-cloud-storage.ts#L97) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `MAX_BLOB_BUFFER_BYTES` | Maximum payload buffered by a built-in blob backend. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/contract.ts#L17) |
| `MAX_BLOB_ID_CODE_UNITS` | Maximum portable blob identifier length accepted by every blob backend. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/blob-id.ts#L6) |
| `MAX_BLOB_METADATA_ENTRIES` | Maximum number of user metadata entries accepted by every blob backend. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/contract.ts#L9) |
| `MAX_BLOB_METADATA_KEY_CODE_UNITS` | Maximum user metadata key length accepted by every blob backend. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/contract.ts#L11) |
| `MAX_BLOB_METADATA_TOTAL_CODE_UNITS` | Maximum combined metadata key/value length accepted by every blob backend. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/contract.ts#L15) |
| `MAX_BLOB_METADATA_VALUE_CODE_UNITS` | Maximum individual user metadata value length accepted by every blob backend. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/contract.ts#L13) |
| `MAX_BLOB_MIME_TYPE_CODE_UNITS` | Maximum media-type length accepted by every blob backend. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/contract.ts#L7) |
| `MAX_BLOB_STREAM_CHUNKS` | Maximum chunks accepted while buffering a stream, including empty chunks. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/blob/contract.ts#L19) |

### `veryfront/workflow/claude-code`

Claude Agent SDK Integration Provides provider-neutral Claude Code capabilities within Veryfront workflows. Agent execution requires an implementation of the `ClaudeCodeAgentRuntime` extension contract, such as `@veryfront/ext-claude-code-agent`.

```ts
import { createAgent, createClaudeCodeTool, createDistributedEventPublisher } from "veryfront/workflow/claude-code";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `ClaudeCodeAgentRuntimeName` | Extension contract name used to resolve a Claude Code agent runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/runtime-contract.ts#L16) |

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createAgent` | Create a reusable agent with snapshotted defaults. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/agent.ts#L293) |
| `createClaudeCodeTool` | Create a customized Claude Code tool | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L163) |
| `createDistributedEventPublisher` | Create an event publisher from an already-activated distributed provider. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L178) |
| `createEventPublisher` | Create an event publisher based on environment | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L199) |
| `createWebSocketHandler` | Create a WebSocket handler for HTTP upgrade requests | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L930) |
| `createWorkspaceSync` | Create a workspace sync for a Claude Code run | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L1866) |
| `executeAgent` | Execute a task through the configured Claude Code agent runtime extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/agent.ts#L250) |
| `withWorkspace` | Execute a function with a synchronized workspace | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L1891) |

#### Classes

| Name | Description | Source |
|------|-------------|--------|
| `AgentControllerRegistry` | Retains one controller generation per run independently of transient publisher connections. Replacements synchronously retire the old publisher; only an exact publisher token can detach, and only an exact run token can terminally release the controller. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L1514) |
| `CallbackEventPublisher` | Simple callback-based publisher Calls a function for each event | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L127) |
| `MemoryEventPublisher` | In-memory event publisher using EventTarget Useful for testing or single-process deployments | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L30) |
| `MultiEventPublisher` | Publishes events to multiple publishers | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L146) |
| `SSEEventPublisher` | Server-Sent Events publisher Writes events directly to a ReadableStream controller | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/event-publisher.ts#L83) |
| `WebSocketPublisher` | WebSocket-based bidirectional publisher | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L469) |
| `WorkspaceSync` | Workspace manager for Claude Code execution | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L630) |
| `WorkspaceUploadAbortError` | Cancellation observed after a persistence batch may already have committed callbacks. The immutable progress and remaining changes make retry decisions explicit instead of disguising committed work as a failed callback. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L194) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `AgentConfig` | Caller-facing agent configuration. Omitted mode defaults to read-only analysis. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/agent.ts#L21) |
| `AgentController` | **Deprecated:** Use `AgentControllerHandle`; lifecycle is registry-owned. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L1060) |
| `AgentControllerConfig` | Run-scoped controller policy. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L412) |
| `AgentControllerHandle` | Run-scoped command surface without transport lifecycle authority. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L422) |
| `AgentControllerRegistration` | Opaque ownership token for one run publisher generation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L449) |
| `AgentControllerRunRegistration` | Opaque ownership token for one run controller generation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L439) |
| `ApprovalRequestEvent` | Approval request event (sent to client when tool needs approval) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L397) |
| `ApproveCommand` | Approve a pending tool call | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L311) |
| `BidirectionalPublisher` | Bidirectional publisher interface (WebSocket) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L472) |
| `CancelCommand` | Cancel the running agent | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L303) |
| `CancelledEvent` | Cancelled event | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L430) |
| `ClaudeCodeAgentExecutionConfig` | Immutable configuration passed from core to an agent runtime extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/runtime-contract.ts#L19) |
| `ClaudeCodeAgentRuntime` | Extension-provided Claude Code execution capability. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/runtime-contract.ts#L45) |
| `ClaudeCodeEvent` | Union of all event types | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L237) |
| `ClaudeCodeEventBase` | Base event interface | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L108) |
| `ClaudeCodeEventBaseExtended` | Base interface for extended events (bidirectional communication) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L387) |
| `ClaudeCodeEventExtended` | Extended event union including bidirectional events | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L461) |
| `ClaudeCodeEventHandler` | Event subscriber callback | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L265) |
| `ClaudeCodeEventPublisher` | Event publisher interface for streaming events | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L255) |
| `ClaudeCodeEventSubscriber` | Event subscriber interface for receiving events | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L270) |
| `ClaudeCodeEventType` | Event types for streaming Claude Code execution | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L90) |
| `ClaudeCodeEventTypeExtended` | Extended event type including bidirectional events | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L376) |
| `ClaudeCodeMode` | Tool modes for Claude Code agent | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L27) |
| `ClaudeCodeResult` | Final result from agent execution | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L45) |
| `ClaudeCodeToolInput` | Input schema type for claude-code workflow tools | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L67) |
| `ClientCommand` | Union of all client commands | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L349) |
| `ClientCommandDisposition` | Handler for client commands | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L359) |
| `ClientCommandHandler` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L363) |
| `ClientCommandObserver` | Passive command observer. Its completion never controls command acknowledgement. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L371) |
| `ClientCommandType` | Client command types for WebSocket communication | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L282) |
| `CommandAckEvent` | Acknowledges the semantic disposition of a keyed client command. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L444) |
| `CompleteEvent` | Complete event (agent finished) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L219) |
| `DistributedEventPublisherOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/distributed/runtime-provider.ts#L90) |
| `ErrorEvent` | Error event | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L227) |
| `FileChange` | File change tracking | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L117) |
| `InputCommand` | Send user input to the agent | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L332) |
| `InputRequestEvent` | Input request event (sent to client when agent needs user input) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L411) |
| `IterationCompleteEvent` | Iteration complete event | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L186) |
| `IterationStartEvent` | Iteration start event | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L122) |
| `PingCommand` | Keepalive ping | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L342) |
| `PongEvent` | Pong response to ping | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L423) |
| `RejectCommand` | Reject a pending tool call | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L321) |
| `TextCompleteEvent` | Text complete event | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L139) |
| `TextDeltaEvent` | Text delta event (streaming text chunk) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L131) |
| `ThinkingCompleteEvent` | Thinking complete event | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L211) |
| `ThinkingDeltaEvent` | Thinking delta event | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L203) |
| `ThinkingStartEvent` | Thinking start event (extended thinking) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L196) |
| `ToolApprovalConfig` | Tool approval configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L488) |
| `ToolCallCompleteEvent` | Tool call complete event | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L165) |
| `ToolCallInputEvent` | Tool call input delta (streaming input JSON) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L156) |
| `ToolCallStartEvent` | Tool call start event | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L147) |
| `ToolResultEvent` | Tool result event | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L175) |
| `UploadResult` | Upload result | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L164) |
| `WebSocketPublisherConfig` | WebSocket publisher configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/websocket-publisher.ts#L394) |
| `WorkspaceConfig` | Workspace configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L53) |
| `WorkspaceFileSource` | Minimal source contract needed to materialize a project workspace. Implementations must bind `listAll` and every `read` in one initialization to the same immutable source snapshot. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L99) |
| `WorkspacePersistenceContext` | Immutable detected change and cancellation state passed to persistence. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L125) |
| `WorkspaceSyncResult` | Workspace sync result | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L137) |
| `WorkspaceUploadPartialResult` | Immutable persistence progress captured when cancellation stops a batch. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/workspace-sync.ts#L182) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `bugFixTool` | Bug fix tool (code mode) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L273) |
| `claudeCodeTool` | Claude Code tool for workflow steps | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L141) |
| `codeReviewTool` | Code review tool (analysis mode, read-only) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L257) |
| `docsTool` | Documentation tool (code mode) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L305) |
| `MAX_CLAUDE_CODE_AGENT_TURNS` | Maximum supported conversation turns for a single core agent request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/agent.ts#L18) |
| `MAX_CLAUDE_CODE_WIRE_ARRAY_ITEMS` | Maximum array entries in structured wire data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L14) |
| `MAX_CLAUDE_CODE_WIRE_FIELD_LENGTH` | Maximum UTF-16 length of one non-identity wire field. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L10) |
| `MAX_CLAUDE_CODE_WIRE_IDENTIFIER_LENGTH` | Maximum UTF-16 length of a wire identity. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L12) |
| `MAX_CLAUDE_CODE_WIRE_JSON_DEPTH` | Maximum nesting depth in structured wire data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L16) |
| `MAX_CLAUDE_CODE_WIRE_JSON_NODES` | Maximum aggregate nodes in structured wire data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L18) |
| `MAX_CLAUDE_CODE_WIRE_KEY_LENGTH` | Maximum UTF-16 length of a structured wire object key. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L22) |
| `MAX_CLAUDE_CODE_WIRE_MESSAGE_BYTES` | Maximum encoded size of one Claude Code wire message. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L8) |
| `MAX_CLAUDE_CODE_WIRE_OBJECT_FIELDS` | Maximum own fields on one structured wire object. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L20) |
| `refactorTool` | Refactoring tool (code mode) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/tool.ts#L289) |

### `veryfront/workflow/claude-code/react`

React hooks for Claude Code streaming

```ts
import { useClaudeCodeStream, useClaudeCodeText, useClaudeCodeWebSocket } from "veryfront/workflow/claude-code/react";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `useClaudeCodeStream` | React hook for streaming Claude Code execution | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/workflow/claude-code/use-claude-code-stream.ts#L136) |
| `useClaudeCodeText` | Simplified hook that returns just the streaming text | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/workflow/claude-code/use-claude-code-stream.ts#L472) |
| `useClaudeCodeWebSocket` | React hook for bidirectional Claude Code streaming | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/workflow/claude-code/use-claude-code-websocket.ts#L222) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `PendingApproval` | Pending approval state | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/workflow/claude-code/use-claude-code-websocket.ts#L86) |
| `PendingInput` | Pending input request state | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/workflow/claude-code/use-claude-code-websocket.ts#L100) |
| `UseClaudeCodeStreamOptions` | Options for useClaudeCodeStream hook | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/workflow/claude-code/use-claude-code-stream.ts#L68) |
| `UseClaudeCodeStreamState` | State for Claude Code streaming | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/workflow/claude-code/use-claude-code-stream.ts#L54) |
| `UseClaudeCodeWebSocketActions` | Actions returned by the hook | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/workflow/claude-code/use-claude-code-websocket.ts#L163) |
| `UseClaudeCodeWebSocketOptions` | Options for useClaudeCodeWebSocket hook | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/workflow/claude-code/use-claude-code-websocket.ts#L128) |
| `UseClaudeCodeWebSocketState` | State for Claude Code WebSocket | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/workflow/claude-code/use-claude-code-websocket.ts#L111) |

### `veryfront/workflow/claude-code/runtime`

Provider-neutral execution contract for Claude Code workflow agents. The core workflow module owns this contract but does not import an agent SDK. A configured extension, such as `@veryfront/ext-claude-code-agent`, provides the implementation at runtime.

```ts
import { ClaudeCodeAgentRuntimeName } from "veryfront/workflow/claude-code/runtime";
```

#### Components

| Name | Description | Source |
|------|-------------|--------|
| `ClaudeCodeAgentRuntimeName` | Extension contract name used to resolve a Claude Code agent runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/runtime-contract.ts#L16) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `ClaudeCodeAgentExecutionConfig` | Immutable configuration passed from core to an agent runtime extension. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/runtime-contract.ts#L19) |
| `ClaudeCodeAgentRuntime` | Extension-provided Claude Code execution capability. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/runtime-contract.ts#L45) |
| `ClaudeCodeMode` | Tool modes for Claude Code agent | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L27) |
| `ClaudeCodeResult` | Final result from agent execution | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/claude-code/types.ts#L45) |

### `veryfront/workflow/discovery`

Workflow Discovery Module Provides utilities for discovering workflow definitions from user code.

```ts
import { createWorkflowRegistry, discoverWorkflows, findWorkflowById } from "veryfront/workflow/discovery";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createWorkflowRegistry` | Create a workflow registry from discovered workflows | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L246) |
| `discoverWorkflows` | Discover all workflows in a project | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L122) |
| `findWorkflowById` | Find a specific workflow by ID | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L220) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `DiscoveredWorkflow` | Discovered workflow info | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L39) |
| `WorkflowDiscoveryOptions` | Options for workflow discovery | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L56) |
| `WorkflowDiscoveryResult` | Result of workflow discovery | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/discovery/workflow-discovery.ts#L76) |

### `veryfront/workflow/react`

Workflow React

```ts
import { useApproval, useWorkflow, useWorkflowList } from "veryfront/workflow/react";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `useApproval` | Manage workflow approval interactions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/workflow/use-approval.ts#L54) |
| `useWorkflow` | React hook for workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/workflow/use-workflow.ts#L68) |
| `useWorkflowList` | List and filter workflow runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/workflow/use-workflow-list.ts#L47) |
| `useWorkflowStart` | React hook for workflow start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/workflow/use-workflow-start.ts#L38) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `UseApprovalOptions` | Options accepted by use approval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/workflow/use-approval.ts#L7) |
| `UseApprovalResult` | Result returned from use approval. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/workflow/use-approval.ts#L17) |
| `UseWorkflowListOptions` | Options accepted by use workflow list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/workflow/use-workflow-list.ts#L11) |
| `UseWorkflowListResult` | Result returned from use workflow list. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/workflow/use-workflow-list.ts#L23) |
| `UseWorkflowOptions` | Options accepted by use workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/workflow/use-workflow.ts#L41) |
| `UseWorkflowResult` | Result returned from use workflow. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/workflow/use-workflow.ts#L53) |
| `UseWorkflowStartOptions` | Options accepted by use workflow start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/workflow/use-workflow-start.ts#L6) |
| `UseWorkflowStartResult` | Result returned from use workflow start. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/react/workflow/use-workflow-start.ts#L14) |

### `veryfront/workflow/worker`

Workflow worker module Provides distributed workflow execution support. Two execution profiles are available: 1. **WorkflowWorker** - In-process polling worker - Polls for stalled workflows and resumes them - Good for trusted code or single-tenant deployments - Simple setup, lower overhead 2. **WorkflowRunManager + ProcessRunExecutor** - Local process execution - Spawns child processes for each workflow - Good for local development without K8s/Docker A workflow run can be backed by a run executor without introducing another user-visible execution type.

```ts
import { createDynamicWorkflowRunEntrypoint, createWorkflowRunEntrypoint, createWorkflowRunManager } from "veryfront/workflow/worker";
```

#### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createDynamicWorkflowRunEntrypoint` | Create a dynamic workflow run entrypoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts#L475) |
| `createWorkflowRunEntrypoint` | Create a workflow run entrypoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts#L401) |
| `createWorkflowRunManager` | Create a workflow run manager backed by run executors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts#L724) |
| `createWorkflowWorker` | Create a workflow worker | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts#L599) |
| `isRunExecutor` | Type guard to check if an object implements RunExecutor | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts#L149) |
| `runDynamicWorkflowRun` | Run a workflow run with dynamic discovery. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts#L141) |
| `runWorkflowRun` | Run the workflow run entrypoint | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts#L160) |

#### Classes

| Name | Description | Source |
|------|-------------|--------|
| `ProcessRunExecutor` | Process run executor | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/process.ts#L133) |
| `WorkflowRunManager` | Workflow run manager | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts#L143) |
| `WorkflowWorker` | Implement workflow worker. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts#L106) |

#### Types

| Name | Description | Source |
|------|-------------|--------|
| `CreateDynamicWorkflowRunEntrypointOptions` | Create a dynamic workflow run entrypoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts#L469) |
| `CreateWorkflowRunEntrypointOptions` | Create a simple workflow run entrypoint script. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts#L302) |
| `DynamicWorkflowRunEntrypointConfig` | Configuration for the dynamic workflow run entrypoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts#L81) |
| `ManagerStats` | Manager statistics | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts#L84) |
| `ManagerStatus` | Manager status | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts#L79) |
| `ProcessRunExecutorConfig` | Process run executor configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/process.ts#L69) |
| `RunExecutionConfig` | Run execution configuration passed to executor | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts#L16) |
| `RunExecutionInfo` | Run execution information returned by executor | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts#L51) |
| `RunExecutionStatus` | Run execution status | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts#L46) |
| `RunExecutor` | Run Executor Interface | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/executors/types.ts#L98) |
| `WorkerStats` | Worker statistics | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts#L64) |
| `WorkerStatus` | Worker status | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts#L59) |
| `WorkflowRunEntrypoint` | One-shot managed workflow entrypoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/shared.ts#L48) |
| `WorkflowRunEntrypointConfig` | Configuration for the workflow run entrypoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts#L71) |
| `WorkflowRunManagerConfig` | Configuration for the workflow run manager backed by run executors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-manager.ts#L47) |
| `WorkflowWorkerConfig` | Configuration for the workflow worker | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/workflow-worker.ts#L33) |

#### Constants

| Name | Description | Source |
|------|-------------|--------|
| `DYNAMIC_EXIT_CODES` | Exit codes for the dynamic workflow run entrypoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/dynamic-run-entrypoint.ts#L70) |
| `EXIT_CODES` | Exit codes for the workflow run entrypoint. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/workflow/worker/run-entrypoint.ts#L85) |
