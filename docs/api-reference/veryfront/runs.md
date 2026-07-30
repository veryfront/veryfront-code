---
title: "veryfront/runs"
description: "Canonical durable runs for task, workflow, eval, and schedule-triggered execution."
order: 28
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
| `CancelRunResponseSchema` | Zod schema for a cancel-run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L180) |
| `CreateRunResponseSchema` | Zod schema for a create-run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L174) |
| `RunEventListSchema` | Zod schema for a paginated run-event response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L184) |
| `RunEventSchema` | Zod schema for a run event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L182) |
| `RunListSchema` | Zod schema for a paginated project-run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L186) |
| `RunSchema` | Zod schema for a canonical durable run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L172) |
| `ScheduleRunCreateResponseSchema` | Zod schema for a schedule-triggered create-run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L176) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createRunsClient` | Create a runs client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L598) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `VeryfrontRunsClient` | Public client for canonical durable runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L198) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CancelRunResponse` | Response returned when a run is cancelled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L209) |
| `CreateEvalRunInput` | Input payload for creating an eval run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L115) |
| `CreateRunResponse` | Response returned when a run is accepted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L203) |
| `CreateScheduleRunFromSourceInput` | Input for resolving and triggering one pushed source-defined schedule. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L130) |
| `CreateScheduleRunFromSourceResult` | Cloud schedule metadata returned with an accepted source-triggered run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L137) |
| `CreateScheduleRunInput` | Input for triggering one persisted schedule by its canonical UUID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L123) |
| `CreateTaskRunInput` | Input payload for creating a task run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L97) |
| `CreateWorkflowRunInput` | Input payload for creating a workflow run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L107) |
| `KnowledgeIngestByUploadIdsInput` | Input payload for knowledge ingest by upload IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L147) |
| `KnowledgeIngestByUploadPathsInput` | Input payload for knowledge ingest by upload paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L153) |
| `KnowledgeIngestByUploadPrefixInput` | Input payload for knowledge ingest by upload prefix. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L159) |
| `ListRunEventsOptions` | Pagination options for reading a run's canonical event stream. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L173) |
| `ListRunsOptions` | Pagination and routing options for listing project runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L165) |
| `ProjectScopedOptions` | Options accepted by project-scoped run requests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L68) |
| `Run` | Canonical durable run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L201) |
| `RunCreateBaseInput` | Identity fields shared by task, workflow, and eval run creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L87) |
| `RunEvent` | Event emitted by a run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L211) |
| `RunExecutionError` | Error payload recorded for failed task and workflow runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L199) |
| `RunKind` | Canonical durable run kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L189) |
| `RunList` | Paginated project run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L215) |
| `RunOwner` | Canonical durable run owner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L193) |
| `RunRuntimeTargetKind` | Runtime target kind recorded on task, workflow, and eval runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L195) |
| `RunRuntimeTargetOptions` | Runtime target fields accepted by run creation APIs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L77) |
| `RunStatus` | Canonical durable run status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L191) |
| `RunTriggerKind` | Trigger kind recorded on scheduled or externally-started runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L197) |
| `ScheduleRunCreateResponse` | Response returned when a schedule-triggered run is accepted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L205) |
| `VeryfrontRunsClientConfig` | Configuration used by the Veryfront runs client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L47) |
| `VeryfrontRunsRequestContext` | Immutable credentials and project routing for an isolated runs client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L62) |
