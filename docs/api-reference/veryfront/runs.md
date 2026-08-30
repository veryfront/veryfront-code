---
title: "veryfront/runs"
description: "Canonical durable runs for task, workflow, eval, and schedule-triggered execution."
order: 30
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

| Name                              | Description                                                                                                                                                              | Source                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `CancelRunResponseSchema`         | Zod schema for a cancel-run response.                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts) |
| `CreateRunResponseSchema`         | Zod schema for a create-run response.                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts) |
| `RunEventListSchema`              | Zod schema for a paginated run-event response.                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts) |
| `RunEventSchema`                  | Zod schema for a run event whose `event_id` is a non-negative integer.                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts) |
| `RunListSchema`                   | Zod schema for a paginated project-run response.                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts) |
| `RunSchema`                       | Zod schema for a canonical durable run whose `duration_ms` and `backoff_limit` are non-negative integers and whose `timeout_seconds` is a positive integer when present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts) |
| `ScheduleRunCreateResponseSchema` | Zod schema for a schedule-triggered create-run response.                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts) |

### Functions

| Name               | Description           | Source                                                                                  |
| ------------------ | --------------------- | --------------------------------------------------------------------------------------- |
| `createRunsClient` | Create a runs client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts) |

### Classes

| Name                  | Description                               | Source                                                                                  |
| --------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `VeryfrontRunsClient` | Public client for canonical durable runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts) |

### Types

| Name                                 | Description                                                             | Source                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `CancelRunResponse`                  | Response returned when a run is cancelled.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts)     |
| `CreateEvalRunInput`                 | Input payload for creating an eval run.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts) |
| `CreateRunResponse`                  | Response returned when a run is accepted.                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts)     |
| `CreateScheduleRunFromSourceInput`   | Input for resolving and triggering one pushed source-defined schedule.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts) |
| `CreateScheduleRunFromSourceResult`  | Cloud schedule metadata returned with an accepted source-triggered run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts) |
| `CreateScheduleRunInput`             | Input for triggering one persisted schedule by its canonical UUID.      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts) |
| `CreateTaskRunInput`                 |                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts) |
| `CreateWorkflowRunInput`             |                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts) |
| `KnowledgeIngestByUploadIdsInput`    | Input payload for knowledge ingest by upload IDs.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts) |
| `KnowledgeIngestByUploadPathsInput`  | Input payload for knowledge ingest by upload paths.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts) |
| `KnowledgeIngestByUploadPrefixInput` | Input payload for knowledge ingest by upload prefix.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts) |
| `ListRunEventsOptions`               |                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts) |
| `ListRunsOptions`                    |                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts) |
| `ProjectScopedOptions`               | Options accepted by project-scoped run requests.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts) |
| `Run`                                | Canonical durable run.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts)     |
| `RunEvent`                           | Event emitted by a run.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts)     |
| `RunExecutionError`                  | Error payload recorded for failed task and workflow runs.               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts)     |
| `RunKind`                            | Canonical durable run kind.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts)     |
| `RunList`                            | Paginated project run response.                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts)     |
| `RunOwner`                           | Canonical durable run owner.                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts)     |
| `RunRuntimeTargetKind`               | Runtime target for a task, workflow, or eval run.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts) |
| `RunRuntimeTargetOptions`            | Runtime target fields accepted by run creation APIs.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts) |
| `RunStatus`                          | Canonical durable run status.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts)     |
| `RunTriggerKind`                     | Trigger kind recorded on scheduled or externally-started runs.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts)     |
| `ScheduleRunCreateResponse`          | Response returned when a schedule-triggered run is accepted.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts)     |
| `VeryfrontRunsClientConfig`          | Configuration used by the Veryfront runs client.                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts) |
