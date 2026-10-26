---
title: "Run input and output"
description: "What agent, workflow, task, and eval runs store as input and output, and how declared schemas, null, and JSON serialization apply."
order: 340
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

| Run kind | `run.input`                                         | Execution settings                                 | `run.output` without an output schema   | `run.output` with an output schema                                          |
| -------- | --------------------------------------------------- | -------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------- |
| Agent    | Prompt text as `{text}`, or explicit business input | The agent definition and request options           | `{text}` with the final text, or `null` | `{data}` with the validated result, plus `text` when present                |
| Workflow | The submitted value                                 | None on the run                                    | The workflow context without `input`    | The parsed value `output` selects                                           |
| Task     | The submitted value, separate from `config`         | `config`, an object the task reads as `ctx.config` | The value `run()` returns               | The parsed value `run()` returns, see [Declared schemas](#declared-schemas) |
| Eval     | The submitted value                                 | `config`, an object                                | The eval report                         | Not applicable                                                              |

Task, workflow, and eval `input` is any JSON value: an object, an array, a
string, a number, a boolean, or `null`. `null` counts as no input, the same as
leaving the field out. `run.input` keeps the submitted value, and Veryfront
forwards it to the runtime unchanged. What your code receives can differ: a
task falls back to `config`, a workflow starts from `{}` without input, and a
declared `inputSchema` can apply defaults and transforms. The sections below
describe each run kind.

### Agents

New agent runs store prompt input as `{text: "..."}`. Accepted string and
legacy `{prompt: "..."}` invocation forms normalize to this shape. Explicit
business inputs keep their shape. A delegated child stores its submitted prompt
as `{text}`. A project-owned agent run started without input stores `input: null`.

For new agent runs, `run.output.text` holds the accepted final text, and
`run.output.data` holds the validated structured result when the agent declares
`outputSchema`. A structured result can include both fields. Without `outputSchema`, JSON-looking
text stays text; Veryfront does not parse it into `data`. With `outputSchema`,
the runtime parses and validates the final text before returning structured data. If the run produces neither
final text nor structured data, `run.output` is `null`.

The final text is the text the agent wrote after its last tool call. Text
written before a tool call is intermediate narration and is not part of the
output. The hosted runtime reports the structured result as `result` on its
terminal `RunFinished` event; the stored run wraps that value in `output.data`.
The value is a JSON snapshot of the parsed result and can contain capture markers
when it exceeds the snapshot limits. See [Agents](./agents.md) for structured
output, the size limits and the marker fields.

Historical agent records retain their stored input and output shapes. Readers
of historical records can encounter scalar text or a raw structured value.
Task, workflow, and eval outputs do not use the agent text/data envelope.

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

A new agent run without `outputSchema` stores `{text}` with its final text, or
`null` when no final text exists. Veryfront never parses JSON-looking assistant
text into structured data. An eval without
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

| Case                                                                                  | Result                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Submitted task `input` violates `inputSchema`                                         | Fails. `run()` is never called. The run ends `failed` with `error.code: "INPUT_VALIDATION_FAILED"`, the validation errors in `error.details`, and `output: null`.                                                                  |
| Config-only task run (no `input`) whose `config` violates `inputSchema`               | Warns. `run()` receives `config` as before. `metadata.schema_violation.phase` is `"input"`.                                                                                                                                        |
| A task's `run()` returns a value that violates `outputSchema`                         | Warns. The run completes with the returned value unchanged as `output`. `metadata.schema_violation.phase` is `"output"`.                                                                                                           |
| A task's raw JSON Schema that no registered validator can compile                     | Warns. The schema is reported as unenforced, never as enforced: `metadata.schema_violation.reason` is `"schema_uncompilable"`.                                                                                                     |
| A task's execution result lacks, or differs from, the admitted output schema identity | Warns. The run completes. `metadata.schema_violation.phase` is `"identity"`.                                                                                                                                                       |
| Submitted workflow `input` violates `inputSchema`                                     | Fails before the first step runs, with `error.code: "INPUT_VALIDATION_FAILED"` and the validation errors in `error.details`.                                                                                                       |
| A workflow's final output violates `outputSchema`                                     | Fails before completion with `error.code: "OUTPUT_VALIDATION_FAILED"` and `{ path, message }` entries in `error.details.errors`. No output is stored, `onError` runs, and `onComplete` does not.                                   |
| An agent's final text does not parse or validate against `outputSchema`               | Fails. The run stores no partial output. A run that stops at its step limit completes instead; without a structured result, it stores the durable text fallback in `output.text` when present and otherwise stores `output: null`. |
| Submitted eval `input` violates `inputSchema`                                         | Fails before evaluation with `error.code: "INPUT_VALIDATION_FAILED"`, structured validation errors, and `output: null`.                                                                                                            |

An agent's raw JSON Schema `outputSchema` that the registered validator fails
to compile fails the run before the model is called. When the registered
validator has no JSON Schema compiler, the raw schema is still sent to the
provider, but the output is not validated locally. The run stores a JSON
snapshot of the parsed result, as described in [Agents](#agents).

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

For a valid checked task or selected workflow output, the run stores the
parsed value: schema defaults and transforms apply, and a schema that strips
unknown keys strips them from the stored output. Task schema validation must
be available in the runtime. A new agent run stores its structured result in `output.data` as a JSON
snapshot of the parsed value. That value can contain capture markers, as described in
[Agents](#agents). A workflow without `output` stores its default
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
- A task, workflow, or eval returned `null` or returned nothing (`undefined`).
- An agent produced neither final text nor structured data. A structured JSON
  `null` is instead retained as `output.data: null`.
- An agent's terminal turn contains only tool calls and produces neither final
  text nor structured data. Reaching the step limit alone does not imply null:
  same-turn text or a valid structured result can still populate the output.
- A workflow's `output` selector returned `undefined`.

A top-level `output: null` does not distinguish an explicit null output from no output.
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
