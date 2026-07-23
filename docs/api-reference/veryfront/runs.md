---
title: "veryfront/runs"
description: "Canonical durable runs for task, workflow, and eval execution."
order: 26
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
  authToken: "<TOKEN>",
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
| `CancelRunResponseSchema` | Zod schema for a cancel-run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L303) |
| `CreateRunResponseSchema` | Zod schema for a create-run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L299) |
| `RunEventListSchema` | Zod schema for a paginated run-event response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L309) |
| `RunEventSchema` | Zod schema for a run event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L307) |
| `RunListSchema` | Zod schema for a paginated project-run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L311) |
| `RunSchema` | Zod schema for a canonical durable run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L297) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createRunsClient` | Create a runs client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L949) |

### Classes

| Name | Description | Source |
|------|-------------|--------|
| `VeryfrontRunsClient` | Public client for canonical durable runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L530) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `CancelRunResponse` | Response returned when a run is cancelled. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L133) |
| `CreateEvalRunInput` | Input payload for creating an eval run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L140) |
| `CreateRunResponse` | Response returned when a run is accepted. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L123) |
| `CreateTaskRunInput` | Input payload for creating a task run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L112) |
| `CreateWorkflowRunInput` | Input payload for creating a workflow run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L128) |
| `InferSchema` | Extracts the inferred output type `T` from a `Schema<T>`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L119) |
| `InferShape` | Maps a raw object shape to its inferred object type, preserving optionality. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L133) |
| `KnowledgeIngestByUploadIdsInput` | Input payload for knowledge ingest by upload IDs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L152) |
| `KnowledgeIngestByUploadPathsInput` | Input payload for knowledge ingest by upload paths. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L159) |
| `KnowledgeIngestByUploadPrefixInput` | Input payload for knowledge ingest by upload prefix. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L166) |
| `ListRunEventsOptions` | Options for listing events after a known event. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L181) |
| `ListRunsOptions` | Options for listing project runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L173) |
| `ProjectScopedOptions` | Options accepted by project-scoped run requests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L86) |
| `RefinementCtx` | Context passed to a `superRefine` callback. Provides `addIssue` to emit one or more validation issues and `path` to locate the current value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L111) |
| `Run` | Canonical durable run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L53) |
| `RunCreateBaseInput` | Fields shared by task, workflow, and eval run creation. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L102) |
| `RunEvent` | Event emitted by a run. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L141) |
| `RunEventList` | Paginated run event response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L165) |
| `RunExecutionError` | Error payload recorded for failed task and workflow runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L43) |
| `RunKind` | Canonical durable run kind. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L17) |
| `RunList` | Paginated project run response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L173) |
| `RunOwner` | Canonical durable run owner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L29) |
| `RunPageInfo` | Cursor links returned with a page of runs or run events. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L153) |
| `RunRuntimeTargetKind` | Runtime target kind recorded on task and workflow runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L37) |
| `RunRuntimeTargetOptions` | Runtime target fields accepted by run creation APIs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L92) |
| `RunsRequestIdentity` | Atomic request identity returned by a context-aware runs client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L40) |
| `RunsRequestPolicy` | Lifecycle and response limits for Runs API operations. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L58) |
| `RunsRetryConfig` | Retry policy for idempotent Runs API requests. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L48) |
| `RunStatus` | Canonical durable run status. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L20) |
| `RunTriggerKind` | Trigger kind recorded on scheduled or externally-started runs. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/schemas.ts#L40) |
| `Schema` | An opaque schema definition that validates and infers type `T`. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L22) |
| `ValidationFailure` | Failed validation outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L160) |
| `ValidationIssue` | A single validation issue with location context. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L142) |
| `ValidationResult` | Discriminated union of validation outcomes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L170) |
| `ValidationSuccess` | Successful validation outcome. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/schema-validator.ts#L152) |
| `VeryfrontRunsClientConfig` | Configuration used by the Veryfront runs client. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/runs-client.ts#L70) |
