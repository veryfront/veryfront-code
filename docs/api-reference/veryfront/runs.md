---
title: "veryfront/runs"
description: "Canonical durable runs for task, workflow, and eval execution."
order: 26
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
| `CancelRunResponseSchema`         | Zod schema for a cancel-run response.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L150) |
| `CreateRunResponseSchema`         | Zod schema for a create-run response.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L144) |
| `RunEventListSchema`              | Zod schema for a paginated run-event response.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L154) |
| `RunEventSchema`                  | Zod schema for a run event.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L152) |
| `RunListSchema`                   | Zod schema for a paginated project-run response.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L156) |
| `RunSchema`                       | Zod schema for a canonical durable run.                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L142) |
| `ScheduleRunCreateResponseSchema` | Zod schema for a schedule-triggered create-run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L146) |

### Functions

| Name               | Description           | Source                                                                                       |
| ------------------ | --------------------- | -------------------------------------------------------------------------------------------- |
| `createRunsClient` | Create a runs client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L455) |

### Classes

| Name                  | Description                               | Source                                                                                       |
| --------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| `VeryfrontRunsClient` | Public client for canonical durable runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L148) |

### Types

| Name                                 | Description                                                            | Source                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `CancelRunResponse`                  | Response returned when a run is cancelled.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L179)     |
| `CreateEvalRunInput`                 | Input payload for creating an eval run.                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L75)  |
| `CreateRunResponse`                  | Response returned when a run is accepted.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L173)     |
| `CreateScheduleRunFromSourceInput`   | Input for resolving and triggering one pushed source-defined schedule. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L88)  |
| `CreateScheduleRunInput`             | Input for triggering one persisted schedule by its canonical UUID.     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L82)  |
| `CreateTaskRunInput`                 |                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L58)  |
| `CreateWorkflowRunInput`             |                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L67)  |
| `KnowledgeIngestByUploadIdsInput`    | Input payload for knowledge ingest by upload IDs.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L95)  |
| `KnowledgeIngestByUploadPathsInput`  | Input payload for knowledge ingest by upload paths.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L101) |
| `KnowledgeIngestByUploadPrefixInput` | Input payload for knowledge ingest by upload prefix.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L107) |
| `ListRunEventsOptions`               |                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L117) |
| `ListRunsOptions`                    |                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L112) |
| `ProjectScopedOptions`               | Options accepted by project-scoped run requests.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L38)  |
| `Run`                                | Canonical durable run.                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L171)     |
| `RunEvent`                           | Event emitted by a run.                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L181)     |
| `RunExecutionError`                  | Error payload recorded for failed task and workflow runs.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L169)     |
| `RunKind`                            | Canonical durable run kind.                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L159)     |
| `RunList`                            | Paginated project run response.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L185)     |
| `RunOwner`                           | Canonical durable run owner.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L163)     |
| `RunRuntimeTargetKind`               | Runtime target for a task, workflow, or eval run.                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L43)  |
| `RunRuntimeTargetOptions`            | Runtime target fields accepted by run creation APIs.                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L46)  |
| `RunStatus`                          | Canonical durable run status.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L161)     |
| `RunTriggerKind`                     | Trigger kind recorded on scheduled or externally-started runs.         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L167)     |
| `ScheduleRunCreateResponse`          | Response returned when a schedule-triggered run is accepted.           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L175)     |
| `VeryfrontRunsClientConfig`          | Configuration used by the Veryfront runs client.                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L30)  |
