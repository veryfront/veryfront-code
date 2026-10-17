# Run-event authority

This internal reference records the authority and migration gates for managed
model dispatch, tool admission, and runtime observations. Public event parsing
is documented in [Agent Events Protocol](../guides/agent-events.md).

## Primary source areas

- [Durable event appends](../../src/agent/conversation/durable.ts)
- [Managed broker persistence](../../src/agent/hosted/managed-broker-persistence.ts)
- [Executor model dispatch](../../src/agent/hosted/executor-model-dispatch.ts)

## Hosted model-call capture

The trusted API runtime configuration enables `modelCallCaptureReceipts` only after the append API supports exact capture acknowledgements. Until then, project-bound canonical runs retain their existing context persistence and model dispatch. Executor requests and project payloads cannot select this capability.

After activation, the hosted model broker persists one logical `modelCallId` for each generation or streaming operation before provider dispatch. It requires an exact capture receipt matching the authenticated project grant. Provider retries keep the same logical call identity. Missing receipts cannot downgrade an activated run to legacy dispatch.

Exact capture retains assistant `providerMetadata` as a bounded, strict JSON object. This includes native tool-use blocks and signed thinking data required for a provider continuation. The captured messages retain the same metadata sent to the provider. Invalid or non-JSON metadata refuses dispatch; it is never silently removed. Distinct public observation sinks and legacy observations continue to omit assistant provider metadata.

Deploy the additive API assistant-metadata ingestion contract before publishing framework packages that emit this field. Qualify the package with an actual parent run that invokes a child and completes its next model step.

The append response uses the additive `model_call_captures` array. Each receipt contains `event_id`, `model_call_id`, `run_id`, and `project_id`. Only complete captures submitted in that append, including an acknowledged replay, can receive receipts. Preserve `event_id` as the exact server-issued string. A batch cursor or an append count cannot identify a capture occurrence.

Cloud transport removes caller correlation headers and sends `x-veryfront-model-call-id` and `x-veryfront-model-call-capture-event-id` from the acknowledged dispatch scope. The gateway must verify the stored capture and authenticated project/run authority before accepting correlation. These headers and receipts grant no input-read permission.

A missing, malformed, or ambiguous receipt refuses dispatch. An oversized input can leave a truncated legacy audit record, but it has no usable complete-input receipt and sends no provider request. Legacy records and acknowledgements remain readable; they cannot supply missing capture evidence.

Google structured-output capture supports `generationConfig.responseJsonSchema` and the neutral `responseFormat: json_schema` override. Native `generationConfig.responseSchema` uses Google's schema dialect and is unsupported by this capture profile. When capture is required, that setting refuses dispatch. Supporting the native dialect requires a separate schema contract and qualification.

Activation requires matching API support; merging this SDK change does not activate it or establish that the API is deployed. Remove the migration gate only after the API supports receipts, the SDK is released and consumers are pinned, and integrated acceptance tests pass. Projectless canonical runs retain legacy dispatch without new project correlation; target projectless provenance remains unsupported. The gateway owns actual HTTP-attempt IDs and must retain failed attempts independently of billing. Publish usage only when the provider reports the required counters.

## Hosted tool-start admission

The trusted hosted path can opt into tool-start admission when it owns a project-bound run-event writer credential. Before an SDK tool executes, the runtime waits for the ordinary durable tool-start append and its exact admission receipt. The bridge does not append a second tool start. Released paths without this opt-in keep their existing behavior.

The private append sidecar uses `tool_call_starts` entries with `occurrence_id` and `event_index`. The occurrence UUID identifies one submitted start, and the index selects that start in the batch. A provider-local tool id or tool name cannot select an occurrence when calls repeat or run in parallel.

The append response uses `tool_call_admissions` entries with `occurrence_id`, `admission_event_id`, `start_event_id`, `tool_call_id`, `public_tool_call_id`, `run_id`, and `project_id`. Preserve the server-issued event IDs exactly. The SDK validates the submitted occurrence and its authenticated run/project binding. The receipt contains no writer credential.

For the owning Veryfront project MCP endpoint, the private transport sends the receipt as `_meta.tool_call_admission` and the worker-generation credential as `X-Veryfront-Run-Event-Writer-Token`. Normal MCP authentication remains required. The matching API verifies the stored admission and current writer generation before tool side effects. The credential stays inside the trusted transport and never enters application context or public event payloads.

Missing, malformed, or ambiguous receipts refuse opted-in SDK dispatch. Dispatch also refuses when the matching admission transport is unavailable or the owning endpoint has the wrong project, path, or query. Caller admission selectors and writer headers are removed from ordinary requests, tool-list requests, and third-party MCP requests. Third-party calls still require the broker grant and durable start receipt, but receive no Veryfront API proof or credential; their API authority coverage remains a separate observation gate.

This bridge requires matching worker-generation API support. Projectless admission remains unsupported. A synthetic legacy start derived from a tool result or error receives no SDK pre-dispatch admission. The durable start carries `startObservedFromResult: true`, independently of the actual `providerExecuted` flag. Target replay remains unavailable when the source cannot prove an actual tool start.

## Runtime execution and step provenance

The hosted runtime observes execution entry, step start, step end, and the message spans produced within each step. A run's registration or queue admission cannot supply these runtime observations.

The host enables this path for an authenticated project-bound canonical run. The private append request carries `runtime_observations` with an exact `event_index` for each submitted observation. The matching API must validate the writer's execution generation and persist the observation with that accepted event. Retries retain the same observation identities and event associations.

The managed broker reads this opt-in from the actual private persistence sink and validates its run and project against the execution grant before allocation. A public stream flag or an unbound sink cannot enable it. Observation-bearing batches contain at most 100 events, even when the configured batch size is larger.

Runtime observations travel through private carriers and are removed from public chunks and messages. Application context fields cannot enable this authority. A mirrored step reuses the runtime's observed step identity; it does not allocate a competing identity.

Enable this path only with matching API and writer-generation support. Legacy history without these proofs remains readable through the existing run-event surface, but cannot supply missing target execution, step, or message provenance.

## Runtime ownership diagnostic probes

Runtime ownership probes are diagnostic checks for staging qualification. They
verify that the project runtime and external worker paths use the expected
canonical run authority. They do not enable product behavior, grant user
authority, or replace API-side validation.

Use the probes only in staging or an equivalent isolated diagnostic
environment. Enable them for a bounded run, capture the receipts, then remove
the variables. Each probe family requires an expiry value. The value can be an RFC timestamp
or Unix epoch milliseconds. The probe is inactive when the expiry is invalid, in
the past, or more than 6 hours in the future. Operation timeouts default to
5000 ms and are capped at 30000 ms. Probe failures must not change claim,
lease, terminal, or cancellation outcomes.

### Project runtime probe variables

| Variable                                                 | Purpose                                            |
| -------------------------------------------------------- | -------------------------------------------------- |
| `VERYFRONT_RUNTIME_OWNERSHIP_PROBE_STAGE`                | Set to `1` to enable the project runtime probe.    |
| `VERYFRONT_RUNTIME_OWNERSHIP_PROBE_ID`                   | Optional diagnostic id for receipt grouping.       |
| `VERYFRONT_RUNTIME_OWNERSHIP_PROBE_PROJECT_ID`           | Project id expected by the probe.                  |
| `VERYFRONT_RUNTIME_OWNERSHIP_PROBE_ENVIRONMENT_ID`       | Environment id expected by the probe.              |
| `VERYFRONT_RUNTIME_OWNERSHIP_PROBE_EXPIRES_AT`           | Required RFC timestamp or Unix epoch milliseconds. |
| `VERYFRONT_RUNTIME_OWNERSHIP_PROBE_OPERATION_TIMEOUT_MS` | Optional per-operation timeout in milliseconds.    |

### Agent worker probe variables

| Variable                                                              | Purpose                                                    |
| --------------------------------------------------------------------- | ---------------------------------------------------------- |
| `VERYFRONT_AGENT_WORKER_RUNTIME_OWNERSHIP_PROBE_STAGE`                | Set to `1` to enable the external worker probe.            |
| `VERYFRONT_AGENT_WORKER_RUNTIME_OWNERSHIP_PROBE_ID`                   | Optional diagnostic id for receipt grouping.               |
| `VERYFRONT_AGENT_WORKER_RUNTIME_OWNERSHIP_PROBE_PROJECT_ID`           | Project id expected by the probe.                          |
| `VERYFRONT_AGENT_WORKER_RUNTIME_OWNERSHIP_PROBE_WORKER_ID`            | Optional worker id restriction.                            |
| `VERYFRONT_AGENT_WORKER_RUNTIME_OWNERSHIP_PROBE_CHILD_TOOL_CALL_ID`   | Optional child tool call id used by the stale child check. |
| `VERYFRONT_AGENT_WORKER_RUNTIME_OWNERSHIP_PROBE_EXPIRES_AT`           | Required RFC timestamp or Unix epoch milliseconds.         |
| `VERYFRONT_AGENT_WORKER_RUNTIME_OWNERSHIP_PROBE_OPERATION_TIMEOUT_MS` | Optional per-operation timeout in milliseconds.            |

## Event schema contributor verification

The following commands run from the SDK source repository after changing parser behavior, schema artifacts, or generated payload types. They are not installed-project verification commands.

```sh
deno task test:file src/events/
deno task generate
deno run -A src/events/generate-payload-types.mjs
git diff --exit-code -- src/events/payload-types.generated.ts
```

## Descendant history continuation

Canonical single-run pages retain the immutable decimal cursor contract. Reads with `include_descendants: true` explicitly select `cursor_profile=run-events-descendants-v1` and require that additive page profile and preserve the opaque `vfd1.` continuation token exactly. Equal physical event IDs from different producing runs remain distinct history entries. The SDK validates the bounded canonical token encoding, page discriminator, continuation identity, nonregressing physical IDs, and duplicate producing-run/event-ID pairs. It cannot infer physical storage from a member. The API owns total tuple ordering and authorizes the cursor's root, filters, order, store, and view before querying history; client token validation grants no access.

Canonical payload decoding also enforces the selected source schema’s UTF-16 string limits, trimmed parse output, and JSON context-item UTF-8 byte limit. These supplementary checks reject invalid history without changing its values or the frozen schema resources. They follow declared schema fields and applicable union branches; arbitrary JSON inside context data, tool schemas, or forwarded properties stays opaque. Physical-store source segments must retain their canonical encoded spelling.
