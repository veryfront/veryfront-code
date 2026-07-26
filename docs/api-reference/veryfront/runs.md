---
title: "veryfront/runs"
description: "Canonical durable runs for task, workflow, and eval execution."
order: 25
---

## Import

```ts
import {
  createRunsClient,
  CancelRunResponseSchema,
  CreateRunResponseSchema,
  RunEventListSchema,
  RunEventSchema,
  RunListSchema,
} from "veryfront/runs";
```

## Examples

```ts
import { VeryfrontRunsClient } from "veryfront/runs";

const runs = new VeryfrontRunsClient({
  authToken: process.env.VERYFRONT_API_TOKEN,
  projectReference: "my-project",
});

const accepted = await runs.createTaskRun({
  projectId: "00000000-0000-4000-8000-000000000000",
  target: "task:sync-data",
  config: { batchSize: 100 },
});

const events = await runs.events(accepted.run.run_id);
```

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `CancelRunResponseSchema` | Zod schema for a cancel-run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L149) |
| `CreateRunResponseSchema` | Zod schema for a create-run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L147) |
| `RunEventListSchema` | Zod schema for a paginated run-event response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L153) |
| `RunEventSchema` | Zod schema for a run event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L151) |
| `RunListSchema` | Zod schema for a paginated project-run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L155) |
| `RunSchema` | Zod schema for a canonical durable run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L145) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createRunsClient` | Create a runs client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L512) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `VeryfrontRunsClient` | Public client for canonical durable runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L170) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CancelRunResponse` | Response returned when a run is cancelled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L174) |
| `CreateEvalRunInput` | Input payload for creating an eval run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L111) |
| `CreateRunResponse` | Response returned when a run is accepted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L172) |
| `CreateTaskRunInput` | Input payload for creating a task run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L93) |
| `CreateWorkflowRunInput` | Input payload for creating a workflow run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L103) |
| `KnowledgeIngestByUploadIdsInput` | Input payload for knowledge ingest by upload IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L119) |
| `KnowledgeIngestByUploadPathsInput` | Input payload for knowledge ingest by upload paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L125) |
| `KnowledgeIngestByUploadPrefixInput` | Input payload for knowledge ingest by upload prefix. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L131) |
| `ListRunEventsOptions` | Pagination options for reading a run's canonical event stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L145) |
| `ListRunsOptions` | Pagination and routing options for listing project runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L137) |
| `ProjectScopedOptions` | Options accepted by project-scoped run requests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L64) |
| `Run` | Canonical durable run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L170) |
| `RunCreateBaseInput` | Identity fields shared by task, workflow, and eval run creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L83) |
| `RunEvent` | Event emitted by a run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L176) |
| `RunExecutionError` | Error payload recorded for failed task and workflow runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L168) |
| `RunKind` | Canonical durable run kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L158) |
| `RunList` | Paginated project run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L180) |
| `RunOwner` | Canonical durable run owner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L162) |
| `RunRuntimeTargetKind` | Runtime target kind recorded on task, workflow, and eval runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L164) |
| `RunRuntimeTargetOptions` | Runtime target fields accepted by run creation APIs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L73) |
| `RunStatus` | Canonical durable run status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L160) |
| `RunTriggerKind` | Trigger kind recorded on scheduled or externally-started runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L166) |
| `VeryfrontRunsClientConfig` | Configuration used by the Veryfront runs client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L43) |
| `VeryfrontRunsRequestContext` | Immutable credentials and project routing for an isolated runs client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L58) |
