# Context compaction pre-v1 baseline

This document records the pre-v1 context compaction behavior in Veryfront Code
and Veryfront API as reviewed on 2026-06-04. It focuses on hosted chat runs,
internal runtime runs, API request snapshots, and the gap against durable
compaction before the v1 implementation lands.

## Summary

Veryfront currently has size-reduction paths, not real context compaction.

The existing code can trim old messages, synthesize a simple topic summary,
compress old turns before a model call, and shrink API event payloads before
persistence. Those behaviors are useful guards, but they do not create a durable
compaction event, do not track `firstKeptEntryId`, do not preserve a structured
verbatim tail by policy, and do not rebuild future context from summary plus
retained tail.

## Veryfront Code

### Local memory implementations

`src/agent/memory/memory.ts` contains three memory implementations:

- `ConversationMemory` keeps an in-memory message list, slices by
  `maxMessages`, then removes oldest messages until the estimated token count
  fits `maxTokens`.
- `BufferMemory` keeps only the last configured number of messages.
- `SummaryMemory` keeps a string summary and a message tail. When the message
  count crosses the threshold, it summarizes the oldest half by extracting user
  topics and replaces the summary with text shaped like `Discussed: ...`.

This is lossy and local. It does not validate the summary through a schema, does
not call a model, does not record token state, and does not store a durable
compaction marker.

### Provider message budget guards

`src/chat/message-prep.ts` performs provider-message cleanup before model
execution:

- Tool outputs can be masked.
- Old turns can be compressed into short text.
- Old compressed turns can be dropped to fit the effective token budget.
- Trailing assistant messages and tool-call pairing issues are repaired before
  dispatch.

This protects model calls from oversized history, but it is still a preflight
transformation. The result is not persisted as a compaction event and is not
available as a rebuild source for future turns.

### Internal runtime stream compaction

`src/internal-agents/run-stream.ts` converts runtime messages to provider
messages, calls `compactForStep`, and converts the result back before streaming.
The current regression test proves that oversized internal runtime history is
reduced before streaming and that the latest user message survives.

This path is valuable, but it remains a runtime guard. It does not emit a
durable compaction record and does not expose the cut point to API or future chat
preparation.

### Hosted chat preparation

`src/agent/hosted/chat-preparation.ts` normalizes hosted chat requests, prepares
a root run, creates the runtime, and builds final runtime messages through
`prepareHostedChatRuntimeMessages`.

The hosted chat preparation path currently has no dedicated context-budget
manager. It prepares messages, but it does not own durable compaction, event
emission, summary validation, custom instructions, or summary-plus-tail
rebuilding.

## Veryfront API

### Request snapshot event compaction

`src/usecases/agent-runs/request-snapshot-compaction.ts` keeps agent-run event
payloads inside event-size limits:

- Long text is truncated.
- Base64 image payloads are replaced with a notice.
- Tool-result output is replaced with a truncation notice.
- Runtime options and replay-only fields are removed from oversized snapshots.
- If the payload still does not fit, the message list is narrowed to the last
  messages, then latest user message, then minimal latest message.

This is payload-size protection for event persistence. It is not conversation
context compaction. It intentionally removes details to keep the event writable.

### Runtime invocation transport compaction

`src/usecases/agents/runtime-agent-run-client.ts` compacts runtime invocation
messages before sending them over transport when the JSON body is too large. It
reuses Veryfront Code message-prep helpers and logs before and after body sizes
and message counts.

This protects the runtime call boundary. It does not create a reusable
conversation summary and does not update event history with a compaction
boundary.

### Event model baseline

`src/usecases/agent-runs/internal-events.ts` defines internal agent-run event
types such as request enqueueing, tool-result submission, and runtime-owner
binding. At the baseline point for this review, there was no context-compacted
event type.

Existing event-size constants in `src/lib/types/agent-run.types.ts` distinguish
normal events from large request-snapshot events. A real compaction event should
fit the normal event limit by keeping the payload focused on summary text, ids,
and token state.

## Durable compaction comparison

A durable operational compaction flow should provide these properties:

- It appends a durable compaction entry with `summary`, `firstKeptEntryId`,
  `tokensBefore`, optional details, and hook metadata.
- It keeps a recent verbatim tail instead of only dropping old turns.
- It supports custom compaction instructions.
- It tracks token state and cut points.
- It rebuilds later session context from the latest summary plus retained
  messages.

## Gap list

| Capability               | Current Veryfront behavior                                                      | Gap                                                                      |
| ------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Durable compaction event | No dedicated event in Code or API                                               | Future runs cannot identify a compaction boundary                        |
| `firstKeptEntryId`       | Not tracked                                                                     | Summary cannot be paired with the exact retained tail                    |
| Recent verbatim tail     | Kept only as an incidental result of trimming or compression                    | No explicit policy for preserving recent user, assistant, and tool turns |
| Token state              | Estimated locally for trimming and logged for transport compaction              | No durable `tokensBefore`, `tokensAfter`, budget, or reserve state       |
| Custom instructions      | Not supported in hosted chat compaction                                         | Product or system-specific summary rules cannot be injected              |
| Schema validation        | Existing message schemas are used, but summary output is free text or heuristic | Summary payload is not validated as a compaction artifact                |
| Future context rebuild   | Not implemented                                                                 | Future context cannot be rebuilt as summary plus retained tail           |

## Current-state conclusion

Veryfront has the right low-level ingredients: message schemas, token
estimation, provider-message compaction, runtime-message adapters, API event
persistence, and request snapshot guards. The missing piece is a small
hosted-chat compaction coordinator that turns size pressure into a durable,
schema-validated event and a deterministic summary-plus-tail context for later
execution.
