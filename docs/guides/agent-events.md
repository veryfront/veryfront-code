---
title: "Agent Events Protocol"
description: "Parse target Agent Events Protocol CloudEvents with schema-derived TypeScript payloads."
order: 58
---

Use `veryfront/events` when a surface receives target Agent Events Protocol frames and needs the shared parser, target schemas, and per-type payload typings. Keep `veryfront/run-events` for existing stored run-event rows until your surface has completed the protocol cutover. For all public exports, see the [`veryfront/events` API reference](../api-reference/veryfront/events.md).

## Prerequisites

You need an existing Node.js, Bun, or Deno project with `veryfront` installed. Browser and SDK parser examples also use `@veryfront/ext-schema-zod` as the injected JSON Schema validator. It is a separate package, so install it alongside `veryfront`:

<CodeGroup>

```bash npm
npm install veryfront @veryfront/ext-schema-zod
```

```bash pnpm
pnpm add veryfront @veryfront/ext-schema-zod
```

```bash yarn
yarn add veryfront @veryfront/ext-schema-zod
```

```bash bun
bun add veryfront @veryfront/ext-schema-zod
```

```bash deno
deno add npm:veryfront npm:@veryfront/ext-schema-zod
```

</CodeGroup>

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

## Authority and history

Parsing validates an event's shape. Use the platform's authenticated project and
run scopes for event writes, execution, and captured-input reads. Preserve unknown
provenance when history lacks the required evidence; parsing cannot establish that
a provider request or tool execution occurred. Legacy history remains readable
through the existing run-event API.

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

Save this ES module as `verify-events.mjs` in your project. It checks a valid
event and rejects an invalid payload using your installed SDK:

```js
import assert from "node:assert/strict";
import { createEventParser } from "veryfront/events";
import { createZodAdapter } from "@veryfront/ext-schema-zod";

const events = createEventParser(createZodAdapter());
const outgoingEvent = {
  specversion: "1.0",
  id: "verify-stream-closed",
  source: "https://example.test/producer",
  type: "com.veryfront.stream.closed",
  datacontenttype: "application/json",
  dataschema: "urn:veryfront:run-events:target:payloads:1#/$defs/StreamClosed",
  data: { reason: "completed" },
};

const parsed = events.parseEvent(outgoingEvent);
assert.equal(parsed.type, "com.veryfront.stream.closed");
assert.deepEqual(parsed.data, { reason: "completed" });

const invalid = events.safeParseEvent({
  ...outgoingEvent,
  data: { reason: 123 },
});
assert.equal(invalid.success, false);
console.log("Event parsing verified.");
```

Run it with your project's runtime:

<CodeGroup>

```bash node
node verify-events.mjs
```

```bash bun
bun verify-events.mjs
```

```bash deno
deno run verify-events.mjs
```

</CodeGroup>

Successful verification prints `Event parsing verified.` and exits with code 0.
This validates event shape; it does not prove producer authority or delivery.

## Next steps

Read the [`veryfront/events` API reference](../api-reference/veryfront/events.md) for the full export surface. For existing stored run-event rows and streaming behavior during the cutover, see the [`veryfront/run-events` API reference](../api-reference/veryfront/run-events.md) and the server-side streaming notes in [Memory and streaming](memory-and-streaming.md#server-side-streaming).
