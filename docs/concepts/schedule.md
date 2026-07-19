---
title: "Schedule"
description: "How schedules create runs over time."
order: 26
---

A schedule owns a trigger definition. It creates runs at configured times or at
one configured time.

Schedules exist because scheduled work has two separate concerns: when work
starts and what work does. The schedule owns the trigger. The target owns the
business logic.

## Characteristics

- A trigger defines when work starts.
- A target defines what work runs.
- Each trigger creates a run.
- Pausing or deleting the schedule affects future runs, not the task or workflow
  definition.

## Boundary

This keeps scheduling separate from execution.

Use a schedule when work should start automatically. Put the work in a task or
workflow and let the schedule trigger it.

## Wrong fit

Do not put the work itself in the schedule definition. Use a one-time schedule
for delayed one-off work and a cron-style schedule for recurring work.

For implementation steps, see [Runs](../guides/runs.md).

## Monitor a schedule

Opt in to schedule health when a delayed or failed recurring job needs an
operator alert. Set the longest acceptable time since a successful run:

```ts
import { schedule } from "veryfront/schedule";

export default schedule({
  id: "daily-support-triage",
  schedule: "0 9 * * 1-5",
  target: { kind: "workflow", id: "escalate-ticket" },
  health: { maxStalenessSeconds: 1_800 },
});
```

The platform reports the schedule as stale when it has not succeeded within
that budget, and as failed after a newer terminal failure. Health settings are
not sent to the target as run input.
