---
title: "Cron job"
description: "How cron jobs create job runs on a schedule."
order: 26
---

A cron job owns a schedule. It creates job runs at configured times.

Cron jobs exist because scheduled work has two separate concerns: when work
starts and what work does. The cron job owns the schedule. The target owns the
business logic.

## Characteristics

- A schedule defines when work starts.
- A target defines what work runs.
- Each trigger creates a job run.
- Pausing or deleting the schedule affects future runs, not the task or workflow
  definition.

## Boundary

This keeps scheduling separate from execution.

Use a cron job when work should start automatically. Put the work in a task or
workflow and let the cron job trigger it.

## Wrong fit

Do not put the work itself in the schedule definition. Do not use a cron job for
one-off background work. Use a normal job for that.

For implementation steps, see [Jobs](../guides/jobs.md).
