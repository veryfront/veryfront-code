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

## Address a scheduled agent

An agent target carries its own conversation addressing. The target says who
runs and how the platform attaches the run to a hosted conversation.
`agentMessage` says what to send. Both are the canonical authoring form.

```ts
import { schedule } from "veryfront/schedule";

export default schedule({
  id: "triage-new-cases",
  schedule: "*/10 * * * *",
  target: { kind: "agent", id: "case-triage", conversationMode: "create_new" },
  agentMessage: { prompt: "Triage every open case created since the last run." },
});
```

| `conversationMode` | What each occurrence does                             |
| ------------------ | ----------------------------------------------------- |
| `create_new`       | Starts a fresh hosted conversation                    |
| `existing`         | Appends to the conversation named by `conversationId` |
| `none`             | Runs standalone with no hosted conversation           |

`none` is the default, and it is the wrong choice for any agent that delegates.
Delegation through `invoke_agent` needs a hosted conversation to attach the
child run to, so a scheduled agent that delegates fails on every occurrence
under `none`. Use `create_new` for those agents.

`conversationId` is accepted only with `conversationMode: "existing"`, and
`existing` requires it. Local `veryfront schedule run` executes standalone and
therefore rejects `existing`.

`agentMessage` is supported only for agent targets. Its `prompt` is optional;
the platform generates a default prompt when you omit it.

## The legacy locations

`input._schedule_target` is the legacy location for conversation addressing,
and `input.prompt` is the legacy location for prompt content. Both stay
supported: they are what a hosted platform that predates the canonical form
reads, and `veryfront schedule run` falls back to `input.prompt` whenever
`agentMessage.prompt` is absent.

Declaring a value in both places with the same content is accepted. That is how
one definition spans a platform upgrade: an older platform reads the legacy
location, a newer one reads the canonical location, and both find the value you
wrote.

```ts
import { schedule } from "veryfront/schedule";

export default schedule({
  id: "triage-new-cases",
  schedule: "*/10 * * * *",
  target: { kind: "agent", id: "case-triage", conversationMode: "create_new" },
  agentMessage: { prompt: "Triage every open case created since the last run." },
  input: {
    _schedule_target: { conversationMode: "create_new" },
    prompt: "Triage every open case created since the last run.",
  },
});
```

The two declarations must agree. `schedule()` rejects a disagreement between
`target.conversationMode` and `input._schedule_target.conversationMode`,
between the two `conversationId` fields, or between `agentMessage.prompt` and
`input.prompt` with `schedule-config-invalid` instead of choosing a winner,
because honoring one copy would detach the deployed schedule from what the
other copy names.

When `schedule()` evaluates a definition, it holds `input._schedule_target` to
the same conversation rules as the canonical target: its `conversationMode`
must be `create_new`, `existing`, or `none`, `existing` requires a
`conversationId`, and any other key is rejected. Use the canonical target
fields for new source schedules.

`veryfront schedule run --input <file>` replaces the authored input without
passing back through `schedule()`, so it applies the same agreement rules
itself and rejects an operator file that disagrees with the definition.

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
not execute `veryfront.config.ts` or `veryfront.config.js` from the checkout.
Provide the project reference through `veryfront.json`, the local
`.veryfront/project.json` link, or `VERYFRONT_PROJECT_SLUG`,
`VERYFRONT_PROJECT_ID`, `TENANT_PROJECT_SLUG`, or `TENANT_PROJECT_ID`. Remote
runs can infer the project from `package.json` or the directory name only when
no `veryfront.config.ts` or `veryfront.config.js` exists. Remote runs do not
accept `--input`; omit `--remote` when you intentionally want the existing local
execution path.
