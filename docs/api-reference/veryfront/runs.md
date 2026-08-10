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
| `CancelRunResponseSchema`         | Zod schema for a cancel-run response.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L156) |
| `CreateRunResponseSchema`         | Zod schema for a create-run response.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L150) |
| `RunEventListSchema`              | Zod schema for a paginated run-event response.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L160) |
| `RunEventSchema`                  | Zod schema for a run event.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L158) |
| `RunListSchema`                   | Zod schema for a paginated project-run response.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L162) |
| `RunSchema`                       | Zod schema for a canonical durable run.                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L148) |
| `ScheduleRunCreateResponseSchema` | Zod schema for a schedule-triggered create-run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L152) |

### Functions

| Name               | Description           | Source                                                                                       |
| ------------------ | --------------------- | -------------------------------------------------------------------------------------------- |
| `createRunsClient` | Create a runs client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L501) |

### Classes

| Name                  | Description                               | Source                                                                                       |
| --------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `VeryfrontRunsClient` | Public client for canonical durable runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L164) |

### Types

| Name                                 | Description                                                             | Source                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `CancelRunResponse`                  | Response returned when a run is cancelled.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L185)     |
| `CreateEvalRunInput`                 | Input payload for creating an eval run.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L79)  |
| `CreateRunResponse`                  | Response returned when a run is accepted.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L179)     |
| `CreateScheduleRunFromSourceInput`   | Input for resolving and triggering one pushed source-defined schedule.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L94)  |
| `CreateScheduleRunFromSourceResult`  | Cloud schedule metadata returned with an accepted source-triggered run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L101) |
| `CreateScheduleRunInput`             | Input for triggering one persisted schedule by its canonical UUID.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L87)  |
| `CreateTaskRunInput`                 |                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L62)  |
| `CreateWorkflowRunInput`             |                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L71)  |
| `KnowledgeIngestByUploadIdsInput`    | Input payload for knowledge ingest by upload IDs.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L111) |
| `KnowledgeIngestByUploadPathsInput`  | Input payload for knowledge ingest by upload paths.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L117) |
| `KnowledgeIngestByUploadPrefixInput` | Input payload for knowledge ingest by upload prefix.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L123) |
| `ListRunEventsOptions`               |                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L133) |
| `ListRunsOptions`                    |                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L128) |
| `ProjectScopedOptions`               | Options accepted by project-scoped run requests.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L42)  |
| `Run`                                | Canonical durable run.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L177)     |
| `RunEvent`                           | Event emitted by a run.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L187)     |
| `RunExecutionError`                  | Error payload recorded for failed task and workflow runs.               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L175)     |
| `RunKind`                            | Canonical durable run kind.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L165)     |
| `RunList`                            | Paginated project run response.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L191)     |
| `RunOwner`                           | Canonical durable run owner.                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L169)     |
| `RunRuntimeTargetKind`               | Runtime target for a task, workflow, or eval run.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L47)  |
| `RunRuntimeTargetOptions`            | Runtime target fields accepted by run creation APIs.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L50)  |
| `RunStatus`                          | Canonical durable run status.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L167)     |
| `RunTriggerKind`                     | Trigger kind recorded on scheduled or externally-started runs.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L173)     |
| `ScheduleRunCreateResponse`          | Response returned when a schedule-triggered run is accepted.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L181)     |
| `VeryfrontRunsClientConfig`          | Configuration used by the Veryfront runs client.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L34)  |
