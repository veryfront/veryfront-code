---
title: "Run"
description: "How the Code runs client starts and tracks durable task, workflow, and eval executions."
order: 25
---

A [run](/concepts/runs) records one execution. This page describes the durable background-work path exposed by the Code runs client for tasks, workflows, and evals.

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

Create hosted conversation runs with `POST /runs`, an agent target, and the
conversation ID. The API admits and dispatches the run once and provides the
runtime with its durable root descriptor. A hosted runtime rejects a conversation
request without that descriptor before it writes messages or starts execution.
Local runs without a conversation remain supported.

Runtime adapters keep server-issued invocation, event, terminal, and renewal
credentials private. Canonical UUIDs route REST requests; the API validates the
credential's signature, purpose, run binding, and current execution generation.
Locally executed inherited children use their own admitted generation and stop
when their confirmed lease expires or renewal is rejected. Completed runs persist
their final output through `POST /runs/{run_id}/finalize`.

The standalone `createConversationAgentRun`, `getConversationRun`, and
`resyncConversationRunAppendCursor` helpers no longer call the retired durable
projection endpoints. They fail with migration guidance. Use canonical run
admission and `getCanonicalRunStatus` for lifecycle reads. Append receipts and
authenticated conflict headers supply append cursors; an event writer credential
does not grant event-read access. This cutover does not preserve the old standalone
helper contract.

Hosted `veryfront__form_input` suspends through the API's durable checkpoint owner. The old
turn stops after its tool call is persisted; submission resumes a new turn with
the stored private tool result. Public input reads remain redacted for password
fields. Only one form can wait in an execution turn; a second concurrent form
returns a tool error so it cannot block the first form's checkpoint.

Attached local child callbacks cannot yet suspend and redispatch a form. They
return an explicit tool error before creating an input request. Standalone polling
helpers also reject secret forms before creation; use an API-dispatched hosted run
for password input. These limits do not change public secret redaction.

## Explicit agent outcomes

A hosted agent can call `veryfront__succeed_run` with final JSON `output`, or `veryfront__fail_run` with
an `error` containing `code`, `message`, and optional JSON `details`. Use `null`
when success has no output. These platform tools infer the current run from
private execution authority and do not accept a run ID or status.

An accepted outcome stops further tool and model execution. Success records
`completed`; failure records `failed`. A rejected terminal request leaves the
agent able to continue. The existing `veryfront__finalize` tool remains supported.
