---
title: "Job execution model"
description: "How Veryfront Code tasks, jobs, cron jobs, workflow runs, events, and logs fit together."
order: 5
---

Jobs are the durable execution surface for background work. Tasks and workflows
define what can run. Jobs, cron jobs, and workflow runs define how that work is
executed, scheduled, observed, and retried.

The distinction keeps definitions separate from executions. A task or workflow
can be reviewed as reusable product logic. A run can be inspected as one attempt
to execute that logic.

## Execution identities

| Concept      | Identity it owns                           |
| ------------ | ------------------------------------------ |
| Task         | The reusable background function.          |
| Workflow     | The step graph or DAG.                     |
| Job          | Durable execution of one target.           |
| Cron job     | Schedule definition that creates job runs. |
| Workflow run | Canonical run for workflow execution.      |
| Job run      | Canonical run for background execution.    |

Task files and workflow files are definitions. Starting a task creates a job
run. Starting a workflow creates a workflow run that is backed by job execution
for queueing and dispatch.

## Events and logs

Events are the user-visible output stream for a run. Logs are raw debugging
output. Keeping them separate lets product surfaces show stable progress while
still preserving lower-level diagnostics for debugging.
