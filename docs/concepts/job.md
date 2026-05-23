---
title: "Job"
description: "How jobs run tasks and workflows durably."
order: 25
---

A job owns durable execution. It records status, events, logs, and result state
for background work.

Jobs exist because background work needs a durable runtime record. The caller can
start work and later inspect whether it is queued, running, complete, or failed.

## Characteristics

- Status describes where the execution is in its lifecycle.
- Events describe what happened during the run.
- Logs explain operational details.
- Results record the final output.
- Target metadata points back to the task, workflow, or supported target that
  ran.

## Boundary

The target defines what work is done. The job records that the work ran.

Use a job when work needs to outlive an HTTP request or continue after the caller
disconnects. A job can run a task, workflow, or other supported target.

## Wrong fit

Do not use a job for work that must return synchronously in the current request.
Do not put business logic in the job record. Put the logic in the target the job
runs.

For implementation steps, see [Jobs](../guides/jobs.md).
