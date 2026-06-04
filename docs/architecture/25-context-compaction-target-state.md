# Context compaction target state

This document defines the target state for real context compaction in Veryfront
Code and Veryfront API. The goal is to make compaction operationally useful
without adding a large new memory subsystem.

## Design guardrail

Keep the implementation small.

Context compaction should replace the relevant hosted-chat trimming path with
one clear coordinator. It should not introduce a new storage backend, a parallel
event log, a global memory framework, a provider abstraction layer, or a
compatibility flag that keeps old and new hosted-chat behavior alive at the same
time.

## Ownership

Veryfront Code owns the context budget decision and the compacted runtime
message list.

Veryfront API owns durable event validation, persistence, and read access.

The boundary is an explicit compaction event payload. Code decides when and how
to compact. API validates and stores the event.

## ContextBudgetManager

Add a `ContextBudgetManager` for hosted chat runs in Veryfront Code. The first
implementation can be a small module with pure functions. A class is not
required unless stateful ownership becomes useful later.

The manager should accept:

- Runtime messages after hosted chat request normalization.
- Token-budget settings, including context window, reserve tokens, and
  recent-tail target.
- Optional custom compaction instructions.
- A summary generator dependency.

The manager should return:

- The runtime messages to send to the model.
- A token-state summary.
- A compaction event payload when compaction happened.
- No event when the context already fits.

The manager should make one decision per hosted chat preparation pass. It should
not mutate global memory state or persist events directly. The hosted-chat
caller should persist the returned event payload through the existing API path.

## Compaction policy

When estimated context tokens exceed the usable budget, the manager should:

1. Walk backward through messages to select a recent verbatim tail.
2. Preserve recent user, assistant, and tool turns.
3. Keep tool-call and tool-result pairs together where possible.
4. Set `firstKeptEntryId` to the id of the first retained runtime message.
5. Summarize the prefix before that id.
6. Validate the summary through a Zod schema.
7. Build model context as summary message plus retained tail.
8. Emit a durable compaction event.

The first implementation should use a simple tail budget and existing token
estimation. It should not attempt semantic ranking, vector recall, or multi-pass
compression.

## Summary schema

Use a minimal summary artifact.

Recommended shape:

```ts
{
  text: string;
}
```

The schema can add tightly scoped optional metadata later, but only when a caller
uses it. The first version should not create unused fields for files, tasks,
decisions, or entities.

The generated summary must be validated before it is inserted into runtime
context or sent to API as an event payload.

## Durable event

Add an API event for context compaction.

Suggested event type:

```ts
"AGENT_RUN_CONTEXT_COMPACTED";
```

Suggested payload:

```ts
{
  summary: {
    text: string;
  }
  firstKeptEntryId: string;
  tokensBefore: number;
  tokensAfter: number;
  tokenBudget: number;
  reserveTokens: number;
  reason: "context_window" | "transport_body";
}
```

The payload should stay under the normal agent-run event size limit. Request
snapshot compaction should remain an emergency size guard for snapshots, not the
main context-memory mechanism.

## Rebuild rule

Future hosted-chat context should rebuild from the latest compaction event:

1. Find the latest context-compacted event for the run or conversation scope.
2. Insert the validated summary as a synthetic context message.
3. Append the retained messages starting at `firstKeptEntryId` from the stable
   message order.
4. Append all later messages after the compaction event.

If no compaction event exists, use the normal message history.

This keeps future context deterministic and auditable: summary first, retained
verbatim tail second, newer turns last.

When another compaction happens later, it should summarize the currently
effective context, including the prior summary and retained tail. Rebuild should
use only the latest compaction event. Do not chain every historical summary into
model context.

## Synthetic summary message

The rebuilt summary should enter runtime context as one synthetic context
message:

- Use a stable id prefix such as `context_compaction_summary:<firstKeptEntryId>`.
- Use a system or developer-context role according to the existing runtime
  message conventions.
- Prefix the text with `Previous context summary:`.
- Do not treat the synthetic summary as a user turn.

## Summary prompt contract

The summarizer prompt should stay small but explicit. It must preserve:

- The active user goal.
- Explicit decisions and constraints.
- Unresolved tasks and next steps.
- Tool results that affect future work.
- Custom compaction instructions.

It should omit stale logs, repeated tool noise, and details that are no longer
needed after the retained tail.

## Failure policy

If summary generation fails while compaction is required:

- Log the summary failure with the compaction token state.
- Emit no successful compaction event unless the summary schema was validated.
- Fail hosted-chat preparation with a clear context-compaction error.

Do not silently continue with a reduced context. It would hide the fact that
durable compaction did not happen and would make later rebuild behavior
ambiguous.

## Observability

Record structured logs or metrics for each compaction decision:

- Whether compaction happened.
- `tokensBefore`, `tokensAfter`, `tokenBudget`, and `reserveTokens`.
- Summary token count.
- Retained tail token count.
- Compaction reason.
- Summary generation failure reason when applicable.
- Whether emergency provider or transport compaction still fired afterward.

These signals are required for production-grade v1 because they prove whether
context compaction is reducing pressure or hiding a downstream budget problem.

## Budget defaults and caps

The first implementation should define conservative defaults:

- Reserve tokens.
- Recent-tail token target.
- Minimum retained recent turns.
- Maximum summary characters or tokens.
- Maximum compaction event payload size.

These values should be config-driven where the hosted runtime already has a
configuration path, but hardcoded safe defaults are acceptable for the initial
module tests.

## API target behavior

Veryfront API should:

- Validate the new event payload with Zod.
- Store the event through the existing agent-run event repository.
- Keep the event payload focused enough to fit the normal event limit.
- Expose the event anywhere existing run-event reads are used for rebuild or
  diagnostics.
- Keep request-snapshot compaction as a write-size guard only.

API should not generate the summary unless API owns the model execution for that
path. Hosted chat compaction should be decided by Veryfront Code.

## Veryfront Code target behavior

Veryfront Code should:

- Run `ContextBudgetManager` after hosted chat runtime messages are prepared and
  before model execution.
- Use existing runtime-message adapters and token estimation where possible.
- Preserve the recent tail as runtime messages, not provider-only messages.
- Validate summary output before use.
- Emit a single durable event when compaction occurs.
- Record compaction metrics and structured logs.
- Keep existing hard budget guards as final safety checks, not as the primary
  hosted-chat compaction story.

## Non-goals

- No new database tables for the first implementation.
- No vector memory or retrieval layer.
- No semantic dedupe system.
- No compatibility flag for old hosted-chat compaction.
- No broad rewrite of `src/agent/memory/memory.ts`.
- No new dependency.
- No attempt to make request snapshot compaction produce conversation memory.
- No cross-project or user-level long-term memory.

## Success criteria

The target state is reached when an oversized hosted chat run produces a
validated compaction event, sends summary-plus-tail context to the model, stores
`firstKeptEntryId` and token state, and can rebuild later context from that event
without relying on the old lossy hosted-chat trimming behavior.

Production-grade v1 also requires clear summary-failure errors,
latest-compaction replacement, observable token metrics, conservative budget
caps, and realistic tests for long histories, tools, uploads, previous
compaction, and summarizer failure.
