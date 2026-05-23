---
title: "Task"
description: "How tasks define background work targets."
order: 24
---

A task defines background work. It is the target that a job runs.

Tasks exist because some work should be named and reusable before it is run. A
task describes what background work does. A job records one durable execution of
that work.

## Characteristics

- A task has a stable ID.
- A task defines the function to run.
- A task can receive input from a caller or job.
- A task returns a result that the runner can record.

## Boundary

A task is the definition. A job is the durable execution of that definition. Keep
that boundary clear.

Use a task when work should run outside a request or chat turn. Tasks are useful
for sync jobs, imports, cleanup, and other background operations.

## Wrong fit

Do not use a task for interactive model reasoning, streamed chat output, or work
that must stay inside the current HTTP request. Use an agent or app route for
those cases.

For implementation steps, see [Tasks](../guides/tasks.md).
