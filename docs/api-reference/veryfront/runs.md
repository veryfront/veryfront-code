---
title: "veryfront/runs"
description: "Canonical durable runs for task, workflow, and eval execution."
order: 23
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
| `CancelRunResponseSchema` | Zod schema for a cancel-run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L124) |
| `CreateRunResponseSchema` | Zod schema for a create-run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L122) |
| `RunEventListSchema` | Zod schema for a paginated run-event response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L128) |
| `RunEventSchema` | Zod schema for a run event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L126) |
| `RunListSchema` | Zod schema for a paginated project-run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L130) |
| `RunSchema` | Zod schema for a canonical durable run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L120) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createRunsClient` | Create a runs client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L350) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `VeryfrontRunsClient` | Public client for canonical durable runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L124) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CancelRunResponse` | Response returned when a run is cancelled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L149) |
| `CreateRunResponse` | Response returned when a run is accepted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L147) |
| `CreateTaskRunInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L54) |
| `CreateWorkflowRunInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L63) |
| `KnowledgeIngestByUploadIdsInput` | Input payload for knowledge ingest by upload IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L71) |
| `KnowledgeIngestByUploadPathsInput` | Input payload for knowledge ingest by upload paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L77) |
| `KnowledgeIngestByUploadPrefixInput` | Input payload for knowledge ingest by upload prefix. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L83) |
| `ListRunEventsOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L93) |
| `ListRunsOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L88) |
| `ProjectScopedOptions` | Options accepted by project-scoped run requests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L34) |
| `Run` | Canonical durable run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L145) |
| `RunEvent` | Event emitted by a run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L151) |
| `RunExecutionError` | Error payload recorded for failed task and workflow runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L143) |
| `RunKind` | Canonical durable run kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L133) |
| `RunList` | Paginated project run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L155) |
| `RunOwner` | Canonical durable run owner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L137) |
| `RunRuntimeTargetKind` | Runtime target for a task or workflow run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L39) |
| `RunRuntimeTargetOptions` | Runtime target fields accepted by run creation APIs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L42) |
| `RunStatus` | Canonical durable run status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L135) |
| `RunTriggerKind` | Trigger kind recorded on scheduled or externally-started runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L141) |
| `VeryfrontRunsClientConfig` | Configuration used by the Veryfront runs client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L26) |
