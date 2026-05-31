---
title: "veryfront/runs"
description: "Canonical durable runs for task and workflow execution."
---

```ts
import { createRunsClient, VeryfrontRunsClient } from "veryfront/runs";
```

`veryfront/runs` creates and observes project-owned task and workflow runs.

```ts
const runs = createRunsClient({
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

| Export                    | Description                        |
| ------------------------- | ---------------------------------- |
| `createRunsClient`        | Create a runs client.              |
| `VeryfrontRunsClient`     | Client for canonical durable runs. |
| `RunSchema`               | Schema for a canonical run.        |
| `CreateRunResponseSchema` | Schema for run creation responses. |
| `RunEventListSchema`      | Schema for paginated run events.   |
