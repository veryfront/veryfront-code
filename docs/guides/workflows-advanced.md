---
title: "Extend a workflow"
description: "Find the guide for repeated steps, large artifacts, and workflow progress interfaces."
order: 310
---

Add loops, store large artifacts or show workflow progress in React.

## Prerequisites

- A working workflow defined and runnable per [Workflows](./workflows.md).
- For React hooks: a client page that can render React components and an API
  route that matches the hook's `apiBase`.

## Loops

[Repeat workflow steps](./workflow-loops.md) with a condition, a fixed iteration count, or one step per collection item.

## Blob storage

For large workflow artifacts (uploaded files, generated reports, intermediate
datasets), configure `blobStorage` on the executor with a host-provided storage
adapter. The public workflow export exposes the executor integration point.
Storage implementations come from the host runtime: typical hosts wire S3, GCS,
or Vercel Blob behind this adapter.

Without `blobStorage`, large values still flow through step inputs and outputs
in memory, which becomes the bottleneck once individual artifacts exceed a few
hundred kilobytes.


## React hooks

[Show workflow progress in React](./workflow-ui.md) covers authenticated handler routes, run summaries, approvals, CORS, and event streams.

### Understand run summaries

See [Understand run summaries](./workflow-ui.md#understand-run-summaries) for the shared handler response shape.

## Verify it worked

Use the verification in the selected guide. For blob storage, run a workflow with a large artifact and confirm the host adapter stores it and the step result carries its handle.

## Next

- [Remove old workflow runs](./workflow-retention.md): Set a retention period for terminal execution records.
