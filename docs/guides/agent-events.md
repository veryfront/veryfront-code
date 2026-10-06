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
import { createAgentEventParser } from "veryfront/events";
import { createZodAdapter } from "@veryfront/ext-schema-zod";

const events = createAgentEventParser(createZodAdapter());

export function parseEvent(rawEvent: unknown) {
  return events.parseAgentEvent(rawEvent);
}
```

If your server process wants module-level helpers, register the validator once at startup:

```ts
import { parseAgentEvent, registerAgentEventSchemaValidator } from "veryfront/events";
import { createZodAdapter } from "@veryfront/ext-schema-zod";

registerAgentEventSchemaValidator(createZodAdapter());

export function parseEvent(rawEvent: unknown) {
  return parseAgentEvent(rawEvent);
}
```

## Compatibility notes

The project-agent encoder emits reasoning segment events with `messageId` set to the active assistant message and `contentId` set to the reasoning segment id. The AG-UI SSE formatter preserves `contentId` on start, delta, and end frames; legacy frames without it remain valid. Use `contentId` with the owning `messageId` for segment identity. The fallback `messageId = contentId` applies only when reasoning begins before an assistant message is active.

## Read typed payloads

`AgentEvent` narrows by `type`, so `data` has the fields for the selected event.

```ts
import type { AgentEvent } from "veryfront/events";

export function textFromEvent(event: AgentEvent): string | undefined {
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

For a project-bound canonical run, the hosted model broker allocates one logical `modelCallId` for each generation or streaming operation. It persists the prepared input before provider dispatch and requires an exact capture receipt from the run-event append response, matching the project in the authenticated canonical grant. Provider retries keep the same logical call identity.

The append response uses the additive `model_call_captures` array. Each receipt contains `event_id`, `model_call_id`, `run_id`, and `project_id`. Only complete captures submitted in that append, including an acknowledged replay, can receive receipts. Preserve `event_id` as the exact server-issued string. A batch cursor or an append count cannot identify a capture occurrence.

Cloud transport removes caller correlation headers and sends `x-veryfront-model-call-id` and `x-veryfront-model-call-capture-event-id` from the acknowledged dispatch scope. The gateway must verify the stored capture and authenticated project/run authority before accepting correlation. These headers and receipts grant no input-read permission.

A missing, malformed, or ambiguous receipt refuses dispatch. An oversized input can leave a truncated legacy audit record, but it has no usable complete-input receipt and sends no provider request. Legacy records and acknowledgements remain readable; they cannot supply missing capture evidence.

This SDK bridge requires matching API support. Projectless canonical runs keep their supported legacy capture and dispatch behavior without new project correlation; target projectless provenance remains unsupported. The bridge does not create provider-attempt evidence or infer usage from accounting. The gateway owns actual HTTP-attempt IDs and must retain failed attempts independently of billing. Publish usage only when the provider reports the required counters.

## Validate producer output

Parse each outgoing event with the shared validator before publishing it:

```ts
import { createAgentEventParser } from "veryfront/events";
import { createZodAdapter } from "@veryfront/ext-schema-zod";

const events = createAgentEventParser(createZodAdapter());

export function validateOutgoingEvent(outgoingEvent: unknown) {
  const result = events.safeParseAgentEvent(outgoingEvent);
  if (!result.success) {
    throw new TypeError(result.issues[0]?.message ?? "Invalid Agent Events Protocol event");
  }
  return result.data;
}
```

Use `AGENT_EVENT_TYPES` and `AGENT_EVENT_SCHEMA_BY_TYPE` when a producer needs to inspect the protocol surface instead of hard-coding protocol strings.

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
