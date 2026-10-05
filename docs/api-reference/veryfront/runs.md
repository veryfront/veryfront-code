---
title: "veryfront/runs"
description: "Canonical durable runs for task, workflow, eval, and schedule-triggered execution."
order: 31
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

## Deep imports

These import paths group focused functionality under this module. Each is a separate barrel; import only what you need.

### `veryfront/runs/target`

Typed SDK for the Runs target contract, with the pinned contract's operation, input and output types, and the canonical Veryfront API transport it sends requests through. The legacy client stays at `veryfront/runs` until the cutover removes it.

```ts
import { createRunsApiTransport, createRunsSdk, runsProblemOf } from "veryfront/runs/target";
```

#### Components

| Name              | Description                                                                                                                                                           | Source                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `RUNS_OPERATIONS` | Method and path for each Runs target operation, keyed by the contract's operation ID. `client.test.ts` checks every entry against the pinned `paths` at compile time. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/target/operations.ts) |

#### Functions

| Name                     | Description                                                                                                                                                          | Source                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `createRunsApiTransport` | Create the canonical Veryfront API transport for `createRunsSdk`. It owns the origin, credentials, retries, response body limits and telemetry of every SDK request. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/target/transport.ts) |
| `createRunsSdk`          | Create a typed Runs SDK over the given transport.                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/target/client.ts)    |
| `runsProblemOf`          | The problem body of an error thrown by the SDK, or `undefined` for any other error.                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/target/client.ts)    |

#### Types

| Name                       | Description                                                                                        | Source                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `CanonicalRunStreamFrame`  | Canonical JSON carried by the data field of the Runs event stream.                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/target/client.ts)                        |
| `RunsApiTransportOptions`  | Options for `createRunsApiTransport`.                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/target/transport.ts)                     |
| `RunsArgs`                 | Method arguments; the input is optional when it has no required field.                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/target/client.ts)                        |
| `RunsCallOptions`          | Per-call options.                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/target/client.ts)                        |
| `RunsContractComponents`   | Schemas of the pinned Runs contract, for example `RunsContractComponents["schemas"]["Run"]`.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/target/index.ts)                         |
| `RunsContractOperations`   | Operations of the pinned Runs contract, keyed by operation ID.                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/target/index.ts)                         |
| `RunsContractPaths`        | Paths of the pinned Runs contract, keyed by URL template.                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/target/index.ts)                         |
| `RunsInput`                | Request of one operation: path, query and header parameters plus the JSON body.                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/target/client.ts)                        |
| `RunsOperationId`          | Contract operation ID.                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/target/client.ts)                        |
| `RunsOperationRoute`       | HTTP route of one Runs operation.                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/target/operations.ts)                    |
| `RunsOutput`               | Success body of one operation; `undefined` for 204 responses.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/target/client.ts)                        |
| `RunsPaginatedOperationId` | Operations whose responses page with `page_info.next` and a `cursor` query parameter.              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/target/client.ts)                        |
| `RunsProblem`              | RFC 9457 problem body that every Runs error response carries.                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/target/client.ts)                        |
| `RunsResult`               | What an SDK method returns: the parsed body, or the frames of an event stream.                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/target/client.ts)                        |
| `RunsSdk`                  | Typed client for every Runs target operation.                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/target/client.ts)                        |
| `RunsSdkConfig`            | Configuration for `createRunsSdk`.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/target/client.ts)                        |
| `RunStreamFrame`           | One server-sent frame of `streamRunEvents`.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/runs/target/client.ts)                        |
| `TransportRequestInit`     | Options for one transport request.                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/veryfront-api-transport.ts) |
| `TransportRetryConfig`     | Retries after a failed attempt, with exponential backoff between `initialDelay` and `maxDelay` ms. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/veryfront-api-transport.ts) |
| `VeryfrontApiTransport`    | Sends requests to the Veryfront API with the transport's origin, credentials and retries.          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/platform/adapters/veryfront-api-transport.ts) |
