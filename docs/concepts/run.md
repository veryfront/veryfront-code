---
title: "Run"
description: "How runs execute tasks and workflows durably."
order: 25
---

A run owns durable execution. It records status, events, and result state for
background work.

Runs exist because background work needs a durable runtime record. The caller can
start work and later inspect whether it is pending, running, waiting, completed,
failed, or cancelled.

## Characteristics

- Status describes where the execution is in its lifecycle.
- Events describe what happened during the run.
- Results record the final output.
- Target metadata points back to the task, workflow, or supported target that
  ran.

## Boundary

The target defines what work is done. The run records that the work ran.

Use a run when work needs to outlive an HTTP request or continue after the caller
disconnects. A run can execute a task or workflow target.

## Wrong fit

Do not use a run for work that must return synchronously in the current request.
Do not put business logic in the run record. Put the logic in the target the run
runs.

For implementation steps, see [Runs](../guides/runs.md).
