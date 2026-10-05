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

The project-agent encoder now emits reasoning segment events with `messageId` set to the active assistant message and `contentId` set to the reasoning segment id. Consumers that previously grouped reasoning events by their `messageId` should use `contentId` with the owning `messageId` for the segment identity after adopting the protocol. The fallback `messageId = contentId` is only used when a producer emits reasoning before an assistant message is active, which is a defensive path rather than the normal project-agent stream.

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
