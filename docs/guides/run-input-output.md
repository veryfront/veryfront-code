---
title: "Run input and output"
description: "What agent, workflow, task, and eval runs store as input and output, and how declared schemas, null, and JSON serialization apply."
order: 56
---

This page is the input and output contract for every run kind. Use it to
predict what `run.input` and `run.output` hold on `GET /runs/{run_id}`, what
your code receives, and when a run fails instead of completing.

## Prerequisites

- A Veryfront Cloud project with an agent, workflow, task, or eval definition.
- Familiarity with creating and reading runs. See [Runs](./runs.md).

## Input and output by run kind

`run.input` is the business input the caller submitted. Execution settings,
hydrated history, system prompts, tools, and runtime context are never stored
as input. `run.output` is the final business result.

| Run kind | `run.input`                                     | Execution settings                                 | `run.output` without an output schema | `run.output` with an output schema                                          |
| -------- | ----------------------------------------------- | -------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| Agent    | The submitted prompt, or the submitted messages | The agent definition and request options           | The final text, as a string           | The parsed, validated value                                                 |
| Workflow | The submitted value                             | None on the run                                    | The workflow context without `input`  | The parsed value `output` selects                                           |
| Task     | The submitted value, separate from `config`     | `config`, an object the task reads as `ctx.config` | The value `run()` returns             | The parsed value `run()` returns, see [Declared schemas](#declared-schemas) |
| Eval     | The submitted value                             | `config`, an object                                | The eval report                       | Not applicable                                                              |

Task, workflow, and eval `input` is any JSON value: an object, an array, a
string, a number, a boolean, or `null`. `null` counts as no input, the same as
leaving the field out. `run.input` keeps the submitted value, and Veryfront
forwards it to the runtime unchanged. What your code receives can differ: a
task falls back to `config`, a workflow starts from `{}` without input, and a
declared `inputSchema` can apply defaults and transforms. The sections below
describe each run kind.

### Agents

An agent run stores the prompt it was sent. When the caller sends messages
instead of a prompt, the run stores those messages. A delegated child stores
the prompt its parent sent. A project-owned agent run started without a prompt
stores `input: null`.

The final text is the text the agent wrote after its last tool call. Text
written before a tool call is intermediate narration and is not part of the
output. When the agent declares `outputSchema`, the hosted runtime reports the
parsed value as `result` on the `RunFinished` event, and the run stores that
value instead of the text. See [Agents](./agents.md) for structured output.

### Workflows

Steps read the submitted input as `input` in the workflow context. A workflow
run created without input starts with `{}` as its input value, and `run.input`
stays `null`.

Without an `output` selector, a completed run's output is its context without
`input`: every step's output keyed by step id, plus `env` when the project
injects environment values. Declare `output` on the workflow to choose the
value callers receive. `outputSchema` checks the selected or default output
before the run completes. A selected output stores the parsed schema value. A
valid default output keeps its original shape and values. A mismatch fails the
run without storing the invalid output. See [Workflows](./workflows.md).

### Tasks

A task reads `input` as `ctx.input` and `config` as `ctx.config`. A task run
created without `input` gives the task `ctx.input` equal to `ctx.config`, so
tasks that read business data from `config` keep working. See
[Tasks](./tasks.md).

### Evals

An eval that targets an agent reads an object `input` as target hints, such as
`branch_id`. Other evals, and other JSON values, store the input on the run
without reading hints from it. The evaluation runner produces an eval report.
Canonical REST reads expose that report as `output` only for a completed run;
failed and cancelled runs return `output: null`, including evals. Input validation
can fail before an evaluation creates any report.

When the run has a retained report, its `artifacts` array includes an entry with
`type: "eval-report"`. Read the exact authorized `href` from that entry to fetch
the retained report using your normal API client.
A failure before report creation may have no such artifact.

Historical or internal run-summary interfaces may retain a failed eval report in
`output`; that is not the canonical REST guarantee or the current SDK wrapper's
behavior when it reads a canonical run.

## Runs without schemas

A workflow or task that declares no `inputSchema` and no `outputSchema`
behaves as follows:

- The runtime passes the submitted input to your code unchanged, apart from
  the task `config` fallback and the workflow `{}` default described above.
- The output is the value your code produced, in its JSON form.
- The run records no schema violation, and both schema identities are `null`.

An agent without `outputSchema` stores its final text, or `null`. Veryfront
never parses old assistant text into a structured value. An eval without
`inputSchema` accepts any JSON input. Evals do not support `outputSchema`;
their output is the eval report.

## Declared schemas

Validation happens once, in the project runtime. The backend stores the
result and does not validate values a second time.

Task schema validation ships as a warning phase. A project runtime that
includes it applies the task rows below. An earlier runtime treats task
`inputSchema` and `outputSchema` as metadata only: it passes input and output
through unchanged and records no violation. Workflow and agent schemas are
enforced as shown in every release.

| Case                                                                                  | Result                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Submitted task `input` violates `inputSchema`                                         | Fails. `run()` is never called. The run ends `failed` with `error.code: "INPUT_VALIDATION_FAILED"`, the validation errors in `error.details`, and `output: null`.                                |
| Config-only task run (no `input`) whose `config` violates `inputSchema`               | Warns. `run()` receives `config` as before. `metadata.schema_violation.phase` is `"input"`.                                                                                                     |
| A task's `run()` returns a value that violates `outputSchema`                         | Warns. The run completes with the returned value unchanged as `output`. `metadata.schema_violation.phase` is `"output"`.                                                                        |
| A task's raw JSON Schema that no registered validator can compile                     | Warns. The schema is reported as unenforced, never as enforced: `metadata.schema_violation.reason` is `"schema_uncompilable"`.                                                                  |
| A task's execution result lacks, or differs from, the admitted output schema identity | Warns. The run completes. `metadata.schema_violation.phase` is `"identity"`.                                                                                                                    |
| Submitted workflow `input` violates `inputSchema`                                     | Fails before the first step runs, with `error.code: "INPUT_VALIDATION_FAILED"` and the validation errors in `error.details`.                                                                     |
| A workflow's final output violates `outputSchema`                                     | Fails before completion with `error.code: "OUTPUT_VALIDATION_FAILED"` and `{ path, message }` entries in `error.details.errors`. No output is stored, `onError` runs, and `onComplete` does not. |
| An agent's final text does not parse or validate against `outputSchema`               | Fails. The run stores no partial output. A run that stops at its step limit completes instead, with no structured result and `output: null`.                                                    |
| Submitted eval `input` violates `inputSchema` | Fails before evaluation with `error.code: "INPUT_VALIDATION_FAILED"`, structured validation errors, and `output: null`. |

An agent's raw JSON Schema `outputSchema` that the registered validator fails
to compile fails the run before the model is called. When the registered
validator has no JSON Schema compiler, the raw schema is still sent to the
provider, but the output is not validated locally and is stored as parsed.

The task rows marked "Warns" are the warning phase for task schemas. A later
release fails those mismatches too. A recorded mismatch has this shape. A run
keeps the first mismatch detected, with at most 20 errors:

```json
{
  "phase": "output",
  "reason": "invalid",
  "schema_sha256": "<64 hex characters>",
  "errors": [{ "path": "/confidence", "message": "must be number" }],
  "detected_at": "2026-09-30T00:00:00.000Z"
}
```

When a checked output is valid, the run stores the parsed value: schema
defaults and transforms apply, and a schema that strips unknown keys strips
them from the stored output. This applies to a task's return value on a
runtime with task schema validation, to a workflow's `output` selection, and to
an agent's structured result. A workflow without `output` stores its default
output unchanged, even when `outputSchema` accepts it. `ctx.input` on a task run created with `input`, and the
workflow's steps, receive the parsed input. `run.input` keeps the input as
submitted.

Validation applies to the value your code produced: the value `run()` returns,
the value a workflow's `output` selector returns, or the agent's final text.
It does not apply to the value a read returns after any output filtering.
Access control and read filtering do not change what was validated or stored.

Runs created before a schema existed, or before schema identities existed, are
never revalidated or reinterpreted with a newer schema.

## Rejected input

A run whose submitted input violates the declared `inputSchema` is created,
never executes, and fails. Your code never sees the rejected value. REST,
GraphQL, and MCP behave the same way. On a project runtime with task schema
validation, a rejected task run looks like this:

```json
{
  "status": "failed",
  "input": { "ticketText": 42 },
  "output": null,
  "error": {
    "code": "INPUT_VALIDATION_FAILED",
    "message": "Task \"classify-ticket\" input failed inputSchema validation: /ticketText: <message>",
    "details": {
      "errors": [{ "path": "/ticketText", "message": "<message>" }]
    }
  }
}
```

Canonical REST calls the structured error field `error.details`; the SDK
compatibility `Run` wrapper exposes the same value as `error.detail`.

`run.input` keeps the rejected value, so you can inspect what was sent.
`error.details.errors` lists at most 20 errors, each with a JSON Pointer `path`.
A rejected workflow run fails the same way before its first step runs, with
`error.code: "INPUT_VALIDATION_FAILED"` and the validation errors in
`error.details.errors`. Its `error.message` starts with
`Workflow "<id>" input failed inputSchema validation:`.

A request that does not match the create-run request shape, for example a
task `config` that is not an object or an unknown request field, is refused
with a 4xx response and creates no run.

## Absent output and null

`run.output` is `null` in each of these cases:

- The run failed or was cancelled, including an eval run. Read any retained eval
  report through its `eval-report` artifact instead.
- Your code returned `null` or returned nothing (`undefined`).
- An agent's last step ended on a tool call, for example when its step budget
  ran out, so it has no final text.
- A workflow's `output` selector returned `undefined`.

The run record does not distinguish an explicit `null` output from no output.
Read `status` and `error` to tell a completed run that produced `null` from a
run that failed.

## JSON serialization

`run.input` and `run.output` are stored and returned as JSON. The runtime
serializes your result with `JSON.stringify` before it reports it, so the
stored output is the JSON form of what your code produced:

- A `Date` becomes its ISO 8601 string, and an object with `toJSON()` stores
  what `toJSON()` returns.
- Object properties whose value is `undefined`, a function, or a symbol are
  dropped.
- `NaN` and `Infinity` become `null`.

A result that JSON cannot represent fails the run instead of completing it. A
`BigInt` anywhere in the value, or a circular reference, fails the run with the
serialization error in `error.message`. A workflow `output` selector that
returns a function, a symbol, or a `BigInt` fails the run the same way.

Convert these values yourself before you return them, for example a `BigInt`
to a string.

## Schema identity

Canonical REST `GET /runs/{run_id}` declares an optional `schemas` object:

- `schemas.input.sha256`: the identity of the pinned input schema, when present.
- `schemas.output.sha256`: the identity of the pinned output schema, when present.

Each non-null schema entry contains both `schema` and `sha256`. These optional
entries may be absent on the deployed API even for a schema-bound run. Do not
assume every run reports an identity.

Each reported identity is the lowercase sha256 hex of the canonical JSON Schema.
A `defineSchema` schema is converted to JSON Schema first. Object keys are sorted
at every depth, and the result is serialized without whitespace. A recorded
identity names the admitted schema, not the current definition.

The SDK's compatibility `Run` shape exposes `input_schema_sha256` and
`output_schema_sha256`, mapped from the canonical nested identities. It returns
`null` when the corresponding nested identity is unavailable. A missing or null
identity does not establish that the target declared no schema, and historical
runs are not revalidated by reading them.

## Verify it worked

Read a finished run and compare its fields with this contract:

```bash
curl -fsS "$VERYFRONT_API_URL/runs/<RUN_ID>" \
  -H "Authorization: Bearer <TOKEN>" |
  jq '{status, input, output, error, schemas: {input: .schemas.input.sha256, output: .schemas.output.sha256}, artifacts}'
```

A completed task run shows the submitted `input` and the returned value as
`output`. On a project runtime with task schema validation, a task run rejected
for its input shows `status: "failed"`, `output: null`, and
`error.code: "INPUT_VALIDATION_FAILED"`.

## Next steps

- [Runs](./runs.md): create, observe, and cancel runs.
- [Runs API reference](../api-reference/veryfront/runs.md): the SDK compatibility
  `Run` shape, including `input_schema_sha256` and `output_schema_sha256`.
- [Tasks](./tasks.md): task context, `ctx.input`, and `ctx.config`.
- [Workflows](./workflows.md): steps, the workflow context, and output
  selection.
- [Agents](./agents.md): structured output with `outputSchema`.
