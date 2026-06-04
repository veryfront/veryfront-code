# Context compaction migration plan

This plan migrates hosted chat context handling to real compaction without
maintaining a legacy hosted-chat path. Each step should be small, test-backed,
and reversible.

## Step 1: Add shared contracts

Add the smallest useful contracts first.

In Veryfront Code:

- Add a Zod schema for the summary artifact, initially `{ text: string }`.
- Add a Zod schema or typed contract for the compaction result returned by
  `ContextBudgetManager`.
- Reuse existing runtime message schemas and adapters instead of creating a
  parallel message model.

In Veryfront API:

- Add `AGENT_RUN_CONTEXT_COMPACTED` to the internal event type list.
- Add a payload schema with `summary`, `firstKeptEntryId`, `tokensBefore`,
  `tokensAfter`, `tokenBudget`, `reserveTokens`, and `reason`.
- Validate the new event payload through the same event path used by other
  internal events.

Tests:

- Code schema tests for accepted and rejected summary artifacts.
- API event schema tests for accepted and rejected compaction payloads.

## Step 2: Implement ContextBudgetManager in Veryfront Code

Create a hosted-chat `ContextBudgetManager` that:

- Estimates token pressure with existing token helpers.
- Returns unchanged messages when the context fits.
- Selects a recent verbatim tail by walking backward through runtime messages.
- Keeps recent user, assistant, and tool turns intact where possible.
- Sets `firstKeptEntryId` from the first retained message.
- Summarizes the prefix with an injected summary generator.
- Validates the summary output.
- Returns summary-plus-tail runtime messages.
- Records token-state diagnostics for the caller to log or emit.

Keep the summary generator injectable so unit tests do not call a live model.

Tests:

- No compaction when under budget.
- Compaction when over budget.
- Latest user turn is retained.
- Tool-call and tool-result pairs are retained together when they are in the
  tail.
- `firstKeptEntryId` and token fields are set.
- Invalid summary output fails before event emission.
- Summary generation failure emits no compaction event and returns a clear
  context-compaction error.

## Step 3: Wire hosted chat preparation

Call `ContextBudgetManager` in `src/agent/hosted/chat-preparation.ts` after
`prepareHostedChatRuntimeMessages` and before runtime execution.

Behavior after cutover:

- Hosted chat uses the manager output as the runtime message list.
- If compaction happened, Code emits the API event through the existing
  run-event path.
- If summary generation failed, Code logs the failure and emits no successful
  compaction event.
- The old hosted-chat trimming behavior is not kept behind a flag.
- Existing final hard guards can remain only as safety checks for provider or
  transport limits.

Tests:

- Hosted chat over budget emits one compaction event.
- Hosted chat under budget emits no compaction event.
- The runtime receives summary-plus-tail messages after compaction.
- The API event sink receives the validated payload.
- Summary generation failure produces a clear preparation error.
- Emergency provider or transport compaction after hosted-chat compaction is
  logged as a safety-guard hit.

## Step 4: Add API persistence and rebuild support

Extend API event handling so the new compaction event is persisted and readable
through existing run-event access.

Then add latest-compaction rebuild at the hosted-chat boundary:

- Locate the latest `AGENT_RUN_CONTEXT_COMPACTED` event.
- Read `firstKeptEntryId`.
- Rebuild context as summary message plus retained tail from stable message order
  plus later messages.
- Use normal message history when no compaction event exists.

Do not create a second event store, a new table, or a dedicated API replay
service for the first version.

Tests:

- Compaction events persist with validated payloads.
- Latest compaction event wins when multiple events exist.
- Rebuild includes summary first, retained tail second, later turns last.
- Rebuild uses normal message history when no compaction event exists.

## Step 5: Add production observability

Add structured logs or metrics for:

- Whether compaction happened.
- `tokensBefore`, `tokensAfter`, `tokenBudget`, and `reserveTokens`.
- Summary token count.
- Retained tail token count.
- Compaction reason.
- Summary generation failure reason.
- Emergency provider or transport compaction after hosted-chat compaction.

Tests:

- Compaction logs include token state.
- Summary failure logs include failure reason.
- Emergency downstream compaction logs include enough data to identify the
  missed budget.

## Step 6: Add realistic fixtures

Add tests that cover realistic histories:

- Long user and assistant back-and-forth.
- Tool-call and tool-result pairs.
- Uploaded file references.
- Provider-owned remote tool history.
- Previous compaction event.
- Summary generator failure.

Avoid relying only on repeated-character oversized strings. Keep those tests for
hard size limits, but use realistic histories for behavior coverage.

## Step 7: Align runtime transport guards

Keep API transport compaction and request snapshot compaction as emergency
guards, but stop treating them as conversation memory.

Adjust tests and names where needed so the distinction is clear:

- `request-snapshot-compaction.ts` protects event payload size.
- `runtime-agent-run-client.ts` protects transport body size.
- `ContextBudgetManager` owns hosted-chat conversation context compaction.

If runtime transport compaction still fires after hosted-chat compaction, log it
as a safety guard hit. Do not generate a second durable context-compaction event
from transport-only truncation unless the runtime path has the same
summary-plus-tail inputs.

## Step 8: Remove superseded hosted-chat behavior

After the manager is wired and tests pass:

- Remove old hosted-chat-specific trimming or summary behavior that is now
  bypassed.
- Keep generic memory classes only if other callers still use them.
- Delete tests that assert the old hosted-chat trimming shape.
- Replace them with tests that assert durable compaction and summary-plus-tail
  rebuilding.

No legacy mode should remain for hosted chat. The migration is a cutover, not an
old/new switch.

## Verification commands

Run the narrow Code tests first:

```sh
deno test --no-check --allow-all \
  src/agent/hosted/context-budget-manager.test.ts \
  src/agent/hosted/chat-preparation.test.ts \
  src/internal-agents/run-stream.test.ts \
  src/chat/message-prep.test.ts \
  src/agent/runtime/message-adapter.test.ts
```

Run the narrow API tests next:

```sh
pnpm run test:unit -- \
  src/usecases/conversations/agent-runs/start-external-default-chat-run.test.ts \
  src/usecases/runs/create-run.test.ts \
  src/usecases/agents/runtime-agent-run-client.test.ts \
  src/lib/types/agent-run.types.test.ts \
  src/usecases/agent-runs/internal-events.test.ts
```

Before merging implementation work, run the repo-required quick gates:

```sh
deno task check
pnpm run verify:quick
```

Use broader test suites if the event persistence or replay code touches shared
repository behavior.

## Stop condition

Stop when hosted chat can compact an oversized run into a validated summary plus
retained tail, API stores the compaction event with `firstKeptEntryId` and token
state, and replay can rebuild later context from the latest compaction event
without a legacy hosted-chat path.
