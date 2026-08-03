---
title: "veryfront/runs"
description: "Canonical durable runs for task, workflow, eval, and schedule-triggered execution."
order: 28
---

## Import

```ts
import {
  CancelRunResponseSchema,
  CreateRunResponseSchema,
  createRunsClient,
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

| Name                              | Description                                              | Source                                                                                   |
| --------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `CancelRunResponseSchema`         | Zod schema for a cancel-run response.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L155) |
| `CreateRunResponseSchema`         | Zod schema for a create-run response.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L149) |
| `RunEventListSchema`              | Zod schema for a paginated run-event response.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L159) |
| `RunEventSchema`                  | Zod schema for a run event.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L157) |
| `RunListSchema`                   | Zod schema for a paginated project-run response.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L161) |
| `RunSchema`                       | Zod schema for a canonical durable run.                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L147) |
| `ScheduleRunCreateResponseSchema` | Zod schema for a schedule-triggered create-run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L151) |

### Functions

| Name               | Description           | Source                                                                                       |
| ------------------ | --------------------- | -------------------------------------------------------------------------------------------- |
| `createRunsClient` | Create a runs client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L500) |

### Classes

| Name                  | Description                               | Source                                                                                       |
| --------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `VeryfrontRunsClient` | Public client for canonical durable runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L163) |

### Types

| Name                                 | Description                                                             | Source                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `CancelRunResponse`                  | Response returned when a run is cancelled.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L184)     |
| `CreateEvalRunInput`                 | Input payload for creating an eval run.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L78)  |
| `CreateRunResponse`                  | Response returned when a run is accepted.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L178)     |
| `CreateScheduleRunFromSourceInput`   | Input for resolving and triggering one pushed source-defined schedule.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L93)  |
| `CreateScheduleRunFromSourceResult`  | Cloud schedule metadata returned with an accepted source-triggered run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L100) |
| `CreateScheduleRunInput`             | Input for triggering one persisted schedule by its canonical UUID.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L86)  |
| `CreateTaskRunInput`                 |                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L61)  |
| `CreateWorkflowRunInput`             |                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L70)  |
| `KnowledgeIngestByUploadIdsInput`    | Input payload for knowledge ingest by upload IDs.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L110) |
| `KnowledgeIngestByUploadPathsInput`  | Input payload for knowledge ingest by upload paths.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L116) |
| `KnowledgeIngestByUploadPrefixInput` | Input payload for knowledge ingest by upload prefix.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L122) |
| `ListRunEventsOptions`               |                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L132) |
| `ListRunsOptions`                    |                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L127) |
| `ProjectScopedOptions`               | Options accepted by project-scoped run requests.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L41)  |
| `Run`                                | Canonical durable run.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L176)     |
| `RunEvent`                           | Event emitted by a run.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L186)     |
| `RunExecutionError`                  | Error payload recorded for failed task and workflow runs.               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L174)     |
| `RunKind`                            | Canonical durable run kind.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L164)     |
| `RunList`                            | Paginated project run response.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L190)     |
| `RunOwner`                           | Canonical durable run owner.                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L168)     |
| `RunRuntimeTargetKind`               | Runtime target for a task, workflow, or eval run.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L46)  |
| `RunRuntimeTargetOptions`            | Runtime target fields accepted by run creation APIs.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L49)  |
| `RunStatus`                          | Canonical durable run status.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L166)     |
| `RunTriggerKind`                     | Trigger kind recorded on scheduled or externally-started runs.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L172)     |
| `ScheduleRunCreateResponse`          | Response returned when a schedule-triggered run is accepted.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L180)     |
| `VeryfrontRunsClientConfig`          | Configuration used by the Veryfront runs client.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L33)  |
