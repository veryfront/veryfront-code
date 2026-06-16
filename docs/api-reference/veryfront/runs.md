---
title: "veryfront/runs"
description: "Canonical durable runs for task and workflow execution."
order: 22
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
| `CancelRunResponseSchema` | Zod schema for a cancel-run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L123) |
| `CreateRunResponseSchema` | Zod schema for a create-run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L121) |
| `RunEventListSchema` | Zod schema for a paginated run-event response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L127) |
| `RunEventSchema` | Zod schema for a run event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L125) |
| `RunListSchema` | Zod schema for a paginated project-run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L129) |
| `RunSchema` | Zod schema for a canonical durable run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L119) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createRunsClient` | Create a runs client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L351) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `VeryfrontRunsClient` | Public client for canonical durable runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L125) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CancelRunResponse` | Response returned when a run is cancelled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L148) |
| `CreateRunResponse` | Response returned when a run is accepted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L146) |
| `CreateTaskRunInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L55) |
| `CreateWorkflowRunInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L64) |
| `KnowledgeIngestByUploadIdsInput` | Input payload for knowledge ingest by upload IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L72) |
| `KnowledgeIngestByUploadPathsInput` | Input payload for knowledge ingest by upload paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L78) |
| `KnowledgeIngestByUploadPrefixInput` | Input payload for knowledge ingest by upload prefix. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L84) |
| `ListRunEventsOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L94) |
| `ListRunsOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L89) |
| `ProjectScopedOptions` | Options accepted by project-scoped run requests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L35) |
| `Run` | Canonical durable run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L144) |
| `RunEvent` | Event emitted by a run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L150) |
| `RunExecutionError` | Error payload recorded for failed task and workflow runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L142) |
| `RunKind` | Canonical durable run kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L132) |
| `RunList` | Paginated project run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L154) |
| `RunOwner` | Canonical durable run owner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L136) |
| `RunRuntimeTargetKind` | Runtime target for a task or workflow run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L40) |
| `RunRuntimeTargetOptions` | Runtime target fields accepted by run creation APIs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L43) |
| `RunStatus` | Canonical durable run status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L134) |
| `RunTriggerKind` | Trigger kind recorded on scheduled or externally-started runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L140) |
| `VeryfrontRunsClientConfig` | Configuration used by the Veryfront runs client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L27) |
