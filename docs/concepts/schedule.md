---
title: "Schedule"
description: "How schedules create runs over time."
order: 26
---

A schedule owns a trigger definition. Platform-managed schedules can create
runs at configured recurring times or at one configured time. Source-defined
`schedule()` configurations are recurring schedules.

Schedules exist because scheduled work has two separate concerns: when work
starts and what work does. The schedule owns the trigger. The target owns the
business logic.

## Characteristics

- A trigger defines when work starts.
- A target defines what work runs.
- Each trigger creates a run.
- Pausing or deleting the schedule affects future runs, not the task, workflow,
  or agent definition.

## Boundary

This keeps scheduling separate from execution.

Use a schedule when work should start automatically. Put the work in a task or
workflow and let the schedule trigger it.

## Wrong fit

Do not put the work itself in the schedule definition. Use a one-time schedule
through the platform API for delayed one-off work, and a source-defined
cron schedule for recurring work.

For implementation steps, see [Runs](../guides/runs.md).

## Source-defined recurrence

The `schedule` field (or its authoring alias, `cron`) is a five-field POSIX cron
expression:

| Field        |      Accepted range |
| ------------ | ------------------: |
| Minute       |                0-59 |
| Hour         |                0-23 |
| Day of month |                1-31 |
| Month        | 1-12 or `JAN`-`DEC` |
| Day of week  |  0-7 or `SUN`-`SAT` |

Each field accepts `*`, comma-separated values, ranges, and positive steps such
as `*/15` or `1-15/2`. The factory normalizes whitespace and named fields, then
stores the canonical expression in `schedule`.

When `timezone` is present, it must be `UTC` or a supported IANA timezone such
as `Europe/Stockholm`. `timeoutSeconds` bounds local and hosted execution.
`backoffLimit` is a non-negative retry count; set it to `0` to disable retries.

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

## Run a pushed schedule on demand

Use remote mode when the schedule needs the same hosted tools, integrations,
delegation, and durable run context as its cloud recurrence:

```sh
veryfront schedule run daily-support-triage --remote --json
```

Push the source schedule first. Remote runs use the pushed definition and do
not accept `--input`; omit `--remote` when you intentionally want the existing
local execution path.
