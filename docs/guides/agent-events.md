---
title: "Agent Events Protocol"
description: "Parse target Agent Events Protocol CloudEvents with schema-derived TypeScript payloads."
order: 58
---

Use `veryfront/events` when a surface receives target Agent Events Protocol frames and needs the shared parser, target schemas, and per-type payload typings. Keep `veryfront/run-events` for existing stored run-event rows until your surface has completed the protocol cutover. For all public exports, see the [`veryfront/events` API reference](../api-reference/veryfront/events.md).

## Prerequisites

You need an existing Veryfront project with `veryfront` installed. Browser and SDK parser examples also use `@veryfront/ext-schema-zod` as the injected JSON Schema validator.

## Create a parser

Use validator injection for browser code and shared SDK code. It avoids global validator registration for that parser instance. The entrypoint also exports registry helpers for server processes that want module-level parsing.

```ts
import { createEventParser } from "veryfront/events";
import { createZodAdapter } from "@veryfront/ext-schema-zod";

const events = createEventParser(createZodAdapter());

export function parseEvent(rawEvent: unknown) {
  return events.parseEvent(rawEvent);
}
```

If your server process wants module-level helpers, register the validator once at startup:

```ts
import { parseEvent as parseEventRecord, registerEventSchemaValidator } from "veryfront/events";
import { createZodAdapter } from "@veryfront/ext-schema-zod";

registerEventSchemaValidator(createZodAdapter());

export function parseEvent(rawEvent: unknown) {
  return parseEventRecord(rawEvent);
}
```

## Compatibility notes

The project-agent encoder emits reasoning segment events with `messageId` set to the active assistant message and `contentId` set to the reasoning segment id. The AG-UI SSE formatter preserves `contentId` on start, delta, and end frames; legacy frames without it remain valid. Use `contentId` with the owning `messageId` for segment identity. The fallback `messageId = contentId` applies only when reasoning begins before an assistant message is active.

## Read typed payloads

`EventRecord` narrows by `type`, so `data` has the fields for the selected event.

```ts
import type { EventRecord } from "veryfront/events";

export function textFromEvent(event: EventRecord): string | undefined {
  switch (event.type) {
    case "com.veryfront.message.text.delta.emitted":
      return event.data.contentRedacted === true ? undefined : event.data.delta;
    case "com.veryfront.stream.closed":
      return event.data.reason;
    default:
      return undefined;
  }
}
```

## Correlate input requests to tool calls

Input request snapshots and references can include `toolCallId` when the producer knows the exact logical tool-call occurrence that created the request. Keep the field on `inputRequest`, not in `changes`, because the relation is immutable. Omit it when the producer only has a provider-local id or cannot prove the run-level occurrence.

Child-run lifecycle producers should keep the existing `childRunId` and include `childCanonicalRunId` only when the child admission owner supplies the exact canonical run UUID. Omit `childCanonicalRunId` when the producer cannot prove that identity.

## Hosted model-call capture

The trusted API runtime configuration enables `modelCallCaptureReceipts` only after the append API supports exact capture acknowledgements. Until then, project-bound canonical runs retain their existing context persistence and model dispatch. Executor requests and project payloads cannot select this capability.

After activation, the hosted model broker persists one logical `modelCallId` for each generation or streaming operation before provider dispatch. It requires an exact capture receipt matching the authenticated project grant. Provider retries keep the same logical call identity. Missing receipts cannot downgrade an activated run to legacy dispatch.

The append response uses the additive `model_call_captures` array. Each receipt contains `event_id`, `model_call_id`, `run_id`, and `project_id`. Only complete captures submitted in that append, including an acknowledged replay, can receive receipts. Preserve `event_id` as the exact server-issued string. A batch cursor or an append count cannot identify a capture occurrence.

Cloud transport removes caller correlation headers and sends `x-veryfront-model-call-id` and `x-veryfront-model-call-capture-event-id` from the acknowledged dispatch scope. The gateway must verify the stored capture and authenticated project/run authority before accepting correlation. These headers and receipts grant no input-read permission.

A missing, malformed, or ambiguous receipt refuses dispatch. An oversized input can leave a truncated legacy audit record, but it has no usable complete-input receipt and sends no provider request. Legacy records and acknowledgements remain readable; they cannot supply missing capture evidence.

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

## Validate producer output

Parse each outgoing event with the shared validator before publishing it:

```ts
import { createEventParser } from "veryfront/events";
import { createZodAdapter } from "@veryfront/ext-schema-zod";

const events = createEventParser(createZodAdapter());

export function validateOutgoingEvent(outgoingEvent: unknown) {
  const result = events.safeParseEvent(outgoingEvent);
  if (!result.success) {
    throw new TypeError(result.issues[0]?.message ?? "Invalid Agent Events Protocol event");
  }
  return result.data;
}
```

Use `EVENT_TYPES` and `EVENT_SCHEMA_BY_TYPE` when a producer needs to inspect the protocol surface instead of hard-coding protocol strings.

## Verify it worked

Run the event parser tests after changing parser behavior, schema artifacts, or generated payload types:

```sh
deno task test:file src/events/
```

## Regenerate payload types

The payload types are generated from the committed target payload schema artifact. Run the repository generator after changing the target schema JSON:

```sh
deno task generate
```

To check only the Agent Events payload type artifact:

```sh
deno run -A src/events/generate-payload-types.mjs
git diff --exit-code -- src/events/payload-types.generated.ts
```

## Next steps

Read the [`veryfront/events` API reference](../api-reference/veryfront/events.md) for the full export surface. For existing stored run-event rows and streaming behavior during the cutover, see the [`veryfront/run-events` API reference](../api-reference/veryfront/run-events.md) and the server-side streaming notes in [Memory and streaming](memory-and-streaming.md#server-side-streaming).
