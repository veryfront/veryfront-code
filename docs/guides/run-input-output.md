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
leaving the field out. Veryfront forwards the submitted value to the runtime
unchanged.

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
value callers receive. With both `output` and `outputSchema`, the schema checks
the selected value before the run completes. Without `output`, `outputSchema`
checks the default output after the run completes, and a mismatch does not
change the stored output. See [Workflows](./workflows.md).

### Tasks

A task reads `input` as `ctx.input` and `config` as `ctx.config`. A task run
created without `input` gives the task `ctx.input` equal to `ctx.config`, so
tasks that read business data from `config` keep working. See
[Tasks](./tasks.md).

### Evals

An eval reads an object `input` as target hints, such as `branch_id`. Other
JSON values are stored on the run and carry no hints. The output is the eval
report, and a failed eval run keeps its report as `output`.

## Runs without schemas

A definition that declares no `inputSchema` and no `outputSchema` behaves as
follows:

- The runtime passes the submitted input to your code unchanged.
- The output is the value your code produced, in its JSON form.
- The run records no schema violation, and both schema identities are `null`.

An agent without `outputSchema` stores its final text, or `null`. Veryfront never parses old
assistant text into a structured value.

## Declared schemas

Validation happens once, in the project runtime. The backend stores the
result and does not validate values a second time.

Task schema validation ships as a warning phase. A project runtime that
includes it applies the task rows below. An earlier runtime treats task
`inputSchema` and `outputSchema` as metadata only: it passes input and output
through unchanged and records no violation. Workflow and agent schemas are
enforced as shown in every release.

| Case                                                                                  | Result                                                                                                                                                           |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Submitted task `input` violates `inputSchema`                                         | Fails. `run()` is never called. The run ends `failed` with `error.code: "INPUT_VALIDATION_FAILED"`, the validation errors in `error.detail`, and `output: null`. |
| Config-only task run (no `input`) whose `config` violates `inputSchema`               | Warns. `run()` receives `config` as before. `metadata.schema_violation.phase` is `"input"`.                                                                      |
| A task's `run()` returns a value that violates `outputSchema`                         | Warns. The run completes with the returned value unchanged as `output`. `metadata.schema_violation.phase` is `"output"`.                                         |
| A task's raw JSON Schema that no registered validator can compile                     | Warns. The schema is reported as unenforced, never as enforced: `metadata.schema_violation.reason` is `"schema_uncompilable"`.                                   |
| A task's execution result lacks, or differs from, the admitted output schema identity | Warns. The run completes. `metadata.schema_violation.phase` is `"identity"`.                                                                                     |
| Submitted workflow `input` violates `inputSchema`                                     | Fails before the first step runs. The validation message is in `error.message`.                                                                                  |
| A workflow's selected output violates `outputSchema`                                  | Fails. No output is stored, `onError` runs, and `onComplete` does not.                                                                                           |
| An agent's final text does not parse or validate against `outputSchema`               | Fails. The run stores no partial output.                                                                                                                         |

An agent's raw `outputSchema` that no validator can compile is logged and not
enforced, and its output is stored unvalidated.

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

When a value is valid, the run stores the parsed value: schema defaults and
transforms apply, and a schema that strips unknown keys strips them from the
stored output. `ctx.input` on a task run created with `input`, and the
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
    "detail": {
      "errors": [{ "path": "/ticketText", "message": "<message>" }]
    }
  }
}
```

`run.input` keeps the rejected value, so you can inspect what was sent.
`error.detail.errors` lists at most 20 errors, each with a JSON Pointer `path`.
A rejected workflow run also fails before its first step runs, with the
validation message in `error.message` and no `error.code`.

A request that does not match the create-run request shape, for example a
task `config` that is not an object or an unknown request field, is refused
with a 4xx response and creates no run.

## Absent output and null

`run.output` is `null` in each of these cases:

- The run failed or was cancelled. An eval run is the exception: a failed eval
  keeps its report.
- Your code returned `null` or returned nothing (`undefined`).
- An agent's last step ended on a tool call, for example when its step budget
  ran out, so it has no final text.
- A workflow's `output` selector returned `undefined`.

The run record does not distinguish an explicit `null` output from no output.
Read `status` and `error` to tell a completed run that produced `null` from a
run that failed.

When a parent agent delegates with `invoke_agent`, the tool result carries the
child's `output` next to its summary. There, the difference is kept: `output`
set to `null` means the child's run output is `null`, and a missing `output`
key means the output was left out, for example because it is too large for the
tool result. The tool result never carries a truncated output.

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

A run names the declared schemas it was admitted against:

- `input_schema_sha256`: the identity of the declared input schema.
- `output_schema_sha256`: the identity of the declared output schema.

Each identity is the lowercase sha256 hex of the canonical JSON Schema. A
`defineSchema` schema is converted to JSON Schema first. Object keys are sorted
at every depth, and the result is serialized without whitespace. An identity
is fixed when the run is admitted, so it names the contract in effect when the
run was created, not the current definition.

An identity is `null` when the definition declares no such schema, for example
`input_schema_sha256` on an agent, which declares no input schema. It is also
`null` when no identity was recorded for the run: runs created before
identities existed, and runs whose runtime does not report one. Both fields are
absent on API versions that predate them. Treat `null` as "unknown contract",
never as proof that the run had no schema.

## Verify it worked

Read a finished run and compare its fields with this contract:

```bash
curl -sS "$VERYFRONT_API_URL/runs/<RUN_ID>" \
  -H "Authorization: Bearer <TOKEN>" |
  jq '{status, input, output, error, input_schema_sha256, output_schema_sha256}'
```

A completed task run shows the submitted `input` and the returned value as
`output`. On a project runtime with task schema validation, a task run rejected
for its input shows `status: "failed"`, `output: null`, and
`error.code: "INPUT_VALIDATION_FAILED"`.

## Next steps

- [Runs](./runs.md): create, observe, and cancel runs.
- [Runs API reference](../api-reference/veryfront/runs.md): the `Run` schema,
  including `input_schema_sha256` and `output_schema_sha256`.
- [Tasks](./tasks.md): task context, `ctx.input`, and `ctx.config`.
- [Workflows](./workflows.md): steps, the workflow context, and output
  selection.
- [Agents](./agents.md): structured output with `outputSchema`.
