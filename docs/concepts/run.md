---
title: "Run"
description: "How the Code runs client starts and tracks durable task, workflow, and eval executions."
order: 25
---

A [run](https://veryfront.com/docs/concepts/runs) records one execution. This page describes the durable background-work path exposed by the Code runs client for tasks, workflows, and evals.

Runs exist because background work needs a durable runtime record. The caller can
start work and later inspect whether it is pending, running, waiting, completed,
failed, or cancelled.

## Characteristics

- Status describes where the execution is in its lifecycle.
- Events describe what happened during the run.
- Results record the final output on the run itself as `output`, alongside
  `error`, `logs`, artifacts, duration, and exit code.
- Target metadata points back to the task, workflow, or supported target that
  ran.

## Boundary

The target defines what work is done. The run records that the work ran.

Use a run when work needs to outlive an HTTP request or continue after the caller
disconnects. A run can execute a task, workflow, or eval target.

## Wrong fit

Use the durable runs client when the caller can start work and inspect the result later. For a synchronous agent response, call the agent's generation method instead. Both are execution paths; business logic belongs in the agent, task, or workflow definition.

For implementation steps, see [Runs](../guides/runs.md).

## Runtime REST cutover

Create hosted conversation runs with `POST /runs`, an agent target and the
conversation ID. Hosted execution requires an admitted run before it can write
messages or begin work. Local runs without a conversation remain supported.

Custom runtimes must keep execution credentials private and stop inherited
local children when their lease expires or renewal is rejected. Persist final
output through `POST /runs/{run_id}/finalize`.

The retired `createConversationAgentRun`, `getConversationRun` and
`resyncConversationRunAppendCursor` helpers fail with migration guidance. Use
canonical run admission and `getCanonicalRunStatus` for lifecycle reads. Read
append cursors from append receipts or authenticated conflict headers. An event
writer credential does not grant event-read access.

Hosted `veryfront__form_input` pauses the turn until the user submits the form,
then resumes in a new turn. Public input reads redact password fields. Only one
form can wait per turn; a second concurrent form returns a tool error.

Attached local child callbacks cannot yet suspend and redispatch a form. They
return an explicit tool error before creating an input request. Standalone polling
helpers also reject secret forms before creation; use an API-dispatched hosted run
for password input. These limits do not change public secret redaction.

## Explicit agent outcomes

A hosted agent can call `veryfront__succeed_run` with final JSON `output`, or `veryfront__fail_run` with
an `error` containing `code`, `message`, and optional JSON `details`. Use `null`
when success has no output. These tools act on the current run and do not accept
a run ID or status.

An accepted outcome stops further tool and model execution. Success records
`completed`; failure records `failed`. A rejected terminal request leaves the
agent able to continue. The existing `veryfront__finalize` tool remains supported.
