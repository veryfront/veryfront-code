# Hosted chat finalization implementation plan

## Goal

Move hosted chat response and detached finalization semantics behind one private deep Module without changing public `veryfront/agent` behavior.

## Constraints

- Preserve all public exports and signatures from `src/agent/index.ts`.
- Keep the new Module private to `src/agent/hosted`.
- Do not add dependencies.
- Write regression tests before implementation edits.
- Keep response/detached arbitration in `chat-execution-runtime.ts`.
- Keep root stream watchdog disposal in `chat-execution-runtime.ts`.
- Keep existing public helper functions as compatibility shims.
- Prefer deletion and reuse over new abstraction.

## Files

Create:

- `src/agent/hosted/hosted-chat-finalization.ts`
- `src/agent/hosted/hosted-chat-finalization.test.ts`

Modify:

- `src/agent/hosted/chat-execution-runtime.ts`
- `src/agent/hosted/chat-execution-runtime.test.ts`, only to keep runtime and shim tests focused
- `src/agent/hosted/stream-finalization.ts`, only if public helper compatibility requires a narrow shim adjustment

Do not modify `src/agent/index.ts` unless a compile check shows an existing public export was accidentally disturbed.

## Baseline verification

Run this before edits:

```bash
deno test --no-check --allow-all \
  src/agent/hosted/stream-finalization.test.ts \
  src/agent/hosted/chat-execution-runtime.test.ts \
  src/agent/hosted/finalized-message.test.ts \
  src/agent/hosted/stream-terminal-error.test.ts \
  src/agent/streaming/stream-outcome.test.ts \
  src/agent/conversation/hosted-terminal.test.ts
```

Expected result: pass before the refactor starts.

## Task 1: Add failing private Module tests

Create `src/agent/hosted/hosted-chat-finalization.test.ts`.

Import the new private Module, existing types, and test helpers:

```ts
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatUiMessage, ChatUiMessageChunk, MessageMetadata } from "../../chat/types.ts";
import type { ConversationRunChunkMirror } from "../conversation/run-chunk-mirror.ts";
import { createMirroredToolChunkState } from "../streaming/mirrored-tool-chunk-state.ts";
import type { HostedChatExecutionLifecycleAdapter } from "./chat-execution-lifecycle-types.ts";
import type { HostedLifecycleTerminalState } from "./lifecycle.ts";
import { finalizeHostedChatRun } from "./hosted-chat-finalization.ts";
```

Use local fixtures equivalent to the narrow fixture shapes in `chat-execution-runtime.test.ts`:

```ts
function createDurableRunMirror(input: {
  calls: string[];
}): ConversationRunChunkMirror {
  return {
    handleChunk: async (chunk) => {
      input.calls.push(`append:${chunk.type}:${"id" in chunk ? chunk.id : ""}`);
    },
    appendEvents: async () => {},
    flush: async () => {
      input.calls.push("flush");
      return {
        latestEventId: 0,
        latestExternalEventSequence: 0,
        pendingEventCount: 0,
        consecutiveFailures: 0,
        disabled: false,
        hasFlushTimer: false,
        hasRetryTimer: false,
        inFlight: false,
      };
    },
    getSnapshot: () => ({
      latestEventId: 0,
      latestExternalEventSequence: 0,
      pendingEventCount: 0,
      consecutiveFailures: 0,
      disabled: false,
      hasFlushTimer: false,
      hasRetryTimer: false,
      inFlight: false,
    }),
    dispose: () => {},
  };
}

function createLifecycleAdapter(input: {
  calls: string[];
  terminalStates?: HostedLifecycleTerminalState[];
  mirror?: ConversationRunChunkMirror | null;
}): HostedChatExecutionLifecycleAdapter {
  const terminalStates = input.terminalStates ?? [];
  return {
    durableRootRun: { runId: "root-run-1", messageId: "assistant-message-1" },
    durableRunMirror: input.mirror ?? null,
    terminal: {
      toTerminalState: (state) => state,
      finalizeRun: async (state) => {
        input.calls.push(`terminal:${state.status}:${state.terminalErrorCode ?? ""}`);
        terminalStates.push(state);
      },
      cancelRun: async (state) => {
        input.calls.push(`terminal:${state.status}:${state.terminalErrorCode ?? ""}`);
        terminalStates.push(state);
      },
      onTerminalState: async () => {},
    },
  };
}
```

Cover these red tests:

- response mode appends fallback chunks, flushes, dispatches completed, then cleanup.
- response mode fails empty non-aborted output before appending fallback chunks.
- response mode preserves `responseMessage.metadata`.
- response mode treats provider-owned `input-available` Tool parts as completed.
- response mode marks local unfinished Tool parts as `output-error` and dispatches failed incomplete Tool terminal state.
- detached mode appends fallback chunks when no durable output was mirrored.
- detached mode fails empty non-aborted output only when `mirroredDurableOutput` is false and fallback content is absent.
- detached mode completes empty output when `mirroredDurableOutput` is true.
- both modes dispatch failed stream error after appending fallback chunks and flushing.
- both modes complete when a late provider body-read error follows a completed final step.
- cleanup errors are logged and suppressed by the hosted Module.

Run the new test and verify RED:

```bash
deno test --no-check --allow-all src/agent/hosted/hosted-chat-finalization.test.ts
```

Expected result: fail with unresolved module or missing export for `./hosted-chat-finalization.ts`.

## Task 2: Implement the private Module

Create `src/agent/hosted/hosted-chat-finalization.ts`.

Use the existing Modules:

- `../../chat/final-step-fallback.ts` for `getLastStreamStep`
- `../../chat/chat-ui-message-helpers.ts` for `extractChatMessageMetadata`
- `../conversation/hosted-terminal.ts` for terminal resolution and dispatch
- `../streaming/stream-outcome.ts` for `hasCompletedStepSignal` and `isLateProviderBodyReadError`
- `./finalized-message.ts` for response and detached state and fallback chunks
- `./stream-terminal-error.ts` for empty-output and stream-error terminal mapping

Implementation outline:

1. Define `HostedChatFinalizationCommon` and `FinalizeHostedChatRunInput`.
2. Add private response state building equivalent to `createHostedChatFinalizeResponseBuildState`.
3. Add private detached state building equivalent to `createHostedChatFinalizeDetachedBuildState`.
4. Add private terminal-state conversion equivalent to `toHostedChatExecutionFinalState`.
5. Add private cleanup suppression equivalent to `cleanupAfterHostedChatExecutionFinalization`.
6. Add private `hasFinalStepCompletionSignal(finalStep)` that extracts `finishReason` and calls `hasCompletedStepSignal(finishReason)`.
7. Add private `shouldFailStreamError`.
8. Implement `finalizeHostedChatRun`.

Required execution order inside `finalizeHostedChatRun`:

1. `const finalStep = await getLastStreamStep(input.streamResult);`
2. Build response or detached state.
3. Evaluate empty-output failure.
4. For empty failure, flush mirror, dispatch failed state from `getEmptyHostedFinalizedMessageTerminalError`, cleanup, and return.
5. Append fallback chunks in array order.
6. Flush mirror.
7. If stream error should fail, dispatch failed terminal state, cleanup, and return.
8. Resolve completed, cancelled, or incomplete Tool terminal state through `resolveConversationHostedTerminalState`.
9. Dispatch through `dispatchConversationHostedTerminalState`.
10. Cleanup.

Use this stream-error rule:

```ts
function shouldFailStreamError(input: {
  isAborted: boolean;
  hasOutput: boolean;
  finalStep: unknown;
  streamError?: unknown | null;
}): boolean {
  if (input.isAborted || input.streamError == null) {
    return false;
  }

  if (
    input.hasOutput &&
    hasFinalStepCompletionSignal(input.finalStep) &&
    isLateProviderBodyReadError(input.streamError)
  ) {
    return false;
  }

  return true;
}
```

Run the new Module tests and verify GREEN:

```bash
deno test --no-check --allow-all src/agent/hosted/hosted-chat-finalization.test.ts
```

Expected result: pass.

## Task 3: Route hosted runtime through the deep Module

Modify `src/agent/hosted/chat-execution-runtime.ts`.

Replace the bodies of `finalizeResponseFinish` and `finalizeDetachedStreamEnd` with calls to `finalizeHostedChatRun`.

Response call shape:

```ts
await finalizeHostedChatRun({
  kind: "response",
  responseMessage: input.responseMessage,
  isAborted: input.isAborted,
  streamResult: input.streamResult,
  lifecycleAdapter: input.lifecycleAdapter,
  mirroredToolChunkState: input.mirroredToolChunkState,
  capturedMessageId: input.capturedMessageId,
  incompleteToolCallsPartErrorText: input.incompleteToolCallsPartErrorText,
  cleanup: input.cleanup,
  logger: input.logger,
  streamError: input.lastStreamError,
});
```

Detached call shape:

```ts
await finalizeHostedChatRun({
  kind: "detached",
  isAborted: input.isAborted,
  mirroredDurableOutput: input.mirroredDurableOutput,
  streamResult: input.streamResult,
  lifecycleAdapter: input.lifecycleAdapter,
  mirroredToolChunkState: input.mirroredToolChunkState,
  capturedMessageId: input.capturedMessageId,
  incompleteToolCallsPartErrorText: input.incompleteToolCallsPartErrorText,
  cleanup: input.cleanup,
  logger: input.logger,
  streamError: input.lastStreamError,
});
```

After routing:

- remove imports that are no longer needed in `chat-execution-runtime.ts`;
- keep public helper exports in `chat-execution-runtime.ts`;
- keep generic `stream-finalization.ts` public behavior unchanged;
- do not export `hosted-chat-finalization.ts` from `src/agent/index.ts`.

Run runtime tests:

```bash
deno test --no-check --allow-all src/agent/hosted/chat-execution-runtime.test.ts
```

Expected result: pass.

## Task 4: Preserve public compatibility shims

Keep focused tests for these public helpers:

- `toHostedChatExecutionFinalState({ status: "completed" })`
- `cleanupAfterHostedChatExecutionFinalization`
- `createHostedChatStreamFinalizationHooks`
- `createHostedChatFinalizeResponseBuildState`
- `createHostedChatFinalizeDetachedBuildState`
- `finalizeHostedResponse`
- `finalizeHostedDetached`

Run the generic finalizer and public-barrel checks:

```bash
deno test --no-check --allow-all src/agent/hosted/stream-finalization.test.ts
deno check src/agent/index.ts
```

Expected result: both pass.

## Task 5: Final focused verification

Run the focused hosted finalization suite:

```bash
deno test --no-check --allow-all \
  src/agent/hosted/hosted-chat-finalization.test.ts \
  src/agent/hosted/chat-execution-runtime.test.ts \
  src/agent/hosted/stream-finalization.test.ts \
  src/agent/hosted/finalized-message.test.ts \
  src/agent/hosted/stream-terminal-error.test.ts \
  src/agent/streaming/stream-outcome.test.ts \
  src/agent/conversation/hosted-terminal.test.ts
```

If the focused suite passes, run broader agent unit coverage:

```bash
deno test --no-check --allow-all --parallel \
  '--ignore=tests,src/workflow/__tests__,cli/commands/*.integration.test.ts'
```

Check diff hygiene:

```bash
git diff --check
git status --short
```

Expected result: no whitespace errors and only intended files changed.

## Acceptance criteria

- `finalizeHostedChatRun(input)` is the only response/detached finalization path used by `chat-execution-runtime.ts`.
- The new Module is private and absent from `src/agent/index.ts`.
- Existing public helper exports remain available.
- Response and detached terminal states match previous behavior.
- Fallback chunks append before mirror flush.
- Terminal dispatch happens after mirror flush.
- Cleanup happens after terminal dispatch.
- Cleanup failures during hosted runtime finalization are logged and suppressed.
- Response/detached exactly-once arbitration remains in `chat-execution-runtime.ts`.
- Root stream watchdog disposal remains in `chat-execution-runtime.ts`.
- Focused tests pass.

## Commit guidance

Use a Lore commit message:

```text
Concentrate hosted chat finalization behind one private interface

Hosted response and detached completion previously crossed a shallow generic
finalizer interface. This change gives the runtime one private hosted
finalization Module while keeping public helper shims compatible.

Constraint: Preserve all public veryfront/agent exports and signatures
Rejected: Add another adapter layer | HostedChatExecutionLifecycleAdapter is already the concrete Seam
Confidence: high
Scope-risk: moderate
Directive: Keep runtime arbitration in chat-execution-runtime.ts; the private finalization Module owns terminal decisions only after a mode is selected
Tested: deno test --no-check --allow-all src/agent/hosted/hosted-chat-finalization.test.ts src/agent/hosted/chat-execution-runtime.test.ts src/agent/hosted/stream-finalization.test.ts src/agent/hosted/finalized-message.test.ts src/agent/hosted/stream-terminal-error.test.ts src/agent/streaming/stream-outcome.test.ts src/agent/conversation/hosted-terminal.test.ts
Not-tested: Full integration suite unless run separately
```

## Remaining risks

- Direct imports from `stream-finalization.ts` by path require the generic helpers to stay compatible.
- Logger type imports can create a cycle; use a structural logger type if that happens.
- Cleanup suppression must stay in the hosted finalization path. Do not make `stream-finalization.ts` suppress cleanup failures unless the public helper contract intentionally changes.
- Broad agent tests can expose public barrel regressions that focused hosted tests do not catch.
