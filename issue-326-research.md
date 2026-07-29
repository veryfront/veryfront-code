# Issue 326 Research: Mixed Suppressed and Valid Tool Calls

## Problem

An Anthropic-backed agent run failed with HTTP 400 after one streamed model step
contained both:

- an unavailable tool call that the runtime suppressed; and
- multiple valid tool calls that executed successfully.

The durable event stream showed the valid tool results immediately before the
provider error. The provider request trace confirmed that Anthropic, rather
than the Veryfront gateway, returned the 400 response.

## Current Runtime Behavior

The stream handler records unavailable calls in `suppressedToolCalls` and omits
them from the executable `toolCalls` collection. This behavior already has
coverage for a step containing only a suppressed call.

During stream-step assembly, the runtime currently appends messages in this
order:

1. assistant message containing valid tool calls;
2. user recovery guidance for suppressed calls;
3. results from valid tool execution.

The provider request converter preserves this role order. Anthropic requires
the results for assistant tool uses to follow those uses without an intervening
user turn, so the mixed case produces an invalid continuation transcript.

## Existing Coverage and Redundancy Check

- Existing recovery coverage proves that a suppressed unavailable call can
  trigger a second model step with a user recovery turn.
- Existing parallel-result conversion combines consecutive tool-result
  messages, but it does not reorder a user message placed between the
  assistant tool uses and their results.
- No test covers a single streamed step containing both suppressed and valid
  tool calls.
- No matching implementation or out-of-scope decision exists on the current
  default branch.

## Considered Approaches

### Repair ordering in the provider converter

Rejected. Provider conversion should not guess whether arbitrary user messages
are runtime recovery notes, and provider-specific transcript repair would hide
an invalid runtime message sequence.

### Attach recovery text to a tool-result message

Rejected. This would mix runtime guidance with tool output and complicate the
tool-result contract.

### Defer the recovery user turn until valid results are persisted

Chosen. The recovery note is only needed as input to the next model step. It can
be constructed when suppression is detected and appended after all results for
the current step. This preserves:

- assistant → tool-result adjacency;
- the recovery note as the final input before continuation; and
- existing suppressed-only recovery behavior.

## Test Seam

Use the public streaming boundary:

```text
agent(...).stream(...).toDataStreamResponse()
```

A fake model is the external provider boundary. The first stream emits one
unavailable call plus two valid calls. The second invocation captures the
provider prompt and proves its final roles are:

```text
assistant → tool → user
```

The tool message must contain results for both valid calls, and the final user
message must contain the suppressed-call recovery guidance.
