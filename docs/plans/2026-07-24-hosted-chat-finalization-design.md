# Hosted chat finalization design

## Target result

Deepen hosted Agent run finalization by moving response and detached completion semantics behind one private Module:

```text
src/agent/hosted/hosted-chat-finalization.ts
```

The Module exposes one private Interface to `chat-execution-runtime.ts`:

```ts
type FinalizeHostedChatRunInput =
  & HostedChatFinalizationCommon
  & (
    | { kind: "response"; responseMessage: ChatUiMessage; isAborted: boolean }
    | { kind: "detached"; isAborted: boolean; mirroredDurableOutput: boolean }
  );

function finalizeHostedChatRun(input: FinalizeHostedChatRunInput): Promise<void>;
```

The Interface is private to `src/agent/hosted`. Do not export it from `src/agent/index.ts` or the public `veryfront/agent` surface.

## Current evidence

Current finalization behavior is split across these files:

| File                                         | Current responsibility                                                                                                                                                                        |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agent/hosted/chat-execution-runtime.ts` | Runtime bootstrap, response/detached arbitration, `lastStreamError` capture, cleanup suppression, root watchdog disposal, runtime helper exports, and calls into the generic finalizer.       |
| `src/agent/hosted/stream-finalization.ts`    | Generic response and detached finalization state machine. It currently owns fallback ordering, mirror flush, terminal dispatch, cleanup, stream-error decisions, and late body-read handling. |
| `src/agent/hosted/finalized-message.ts`      | Response message sanitization, detached fallback message construction, missing text chunks, and missing Tool chunks.                                                                          |
| `src/agent/hosted/stream-terminal-error.ts`  | Empty-output, provider-error, timeout, and stream-error terminal mapping.                                                                                                                     |
| `src/agent/conversation/hosted-terminal.ts`  | Terminal state resolution and dispatch through the concrete hosted lifecycle adapter.                                                                                                         |
| `src/agent/streaming/stream-outcome.ts`      | Late provider body-read detection and finish-reason completion classification. The current exported completion helper is `hasCompletedStepSignal(finishReason)`.                              |
| `src/chat/final-step-fallback.ts`            | `getLastStreamStep` and final-step fallback extraction.                                                                                                                                       |
| `src/agent/index.ts`                         | Public `veryfront/agent` re-exports, including hosted runtime, message, finalizer, terminal-error, and lifecycle helpers.                                                                     |

Current tests that constrain this refactor:

- `src/agent/hosted/chat-execution-runtime.test.ts`
- `src/agent/hosted/stream-finalization.test.ts`
- `src/agent/hosted/finalized-message.test.ts`
- `src/agent/hosted/stream-terminal-error.test.ts`
- `src/agent/streaming/stream-outcome.test.ts`
- `src/agent/conversation/hosted-terminal.test.ts`

## Problem

`stream-finalization.ts` is shallow for hosted chat. Callers must supply:

- final-step retrieval
- response and detached state builders
- empty-message policy
- terminal-error resolver
- fallback appender
- mirror flusher
- terminal dispatcher
- terminal-state resolver
- cleanup behavior
- stream error state

That Interface leaks hosted finalization details back into `chat-execution-runtime.ts`. The useful Module boundary is hosted chat finalization itself: one private operation that receives hosted runtime state after response/detached arbitration has already chosen a mode.

## Chosen design

Create `src/agent/hosted/hosted-chat-finalization.ts` as the single hosted finalization Module.

`hosted-chat-finalization.ts` owns:

- final-step retrieval with `getLastStreamStep(input.streamResult)`
- response message finalization through `buildFinalizedMessageState`
- response fallback chunk construction through `buildFinalizedMessageFallbackChunks`
- detached fallback message construction through `buildDetachedFallbackMessageState`
- detached fallback chunk construction through `buildDetachedFallbackChunks`
- empty-output failure decisions
- incomplete local Tool call failure decisions
- provider-owned Tool input success behavior
- stream-error terminal decisions
- the late provider body-read success exception
- mirror append order
- mirror flush order
- terminal state resolution and dispatch
- finalization cleanup logging and suppression

`chat-execution-runtime.ts` keeps:

- runtime bootstrap
- `runContext.withContext` ownership
- response versus detached arbitration
- exactly-once finish handling through `finishHandlerStarted` and `finishPromise`
- `lastStreamError` capture from `onError`
- explicit `fail(error)` behavior
- stream metadata and generated message ID wiring
- root stream watchdog creation, observation, and disposal
- bootstrap failure behavior
- Agent run span finalization
- public compatibility helper exports

The Module uses `HostedChatExecutionLifecycleAdapter` directly. Do not add another Adapter layer.

## Private Interface

The private file can export its types for colocated tests, but no public barrel must re-export them.

```ts
export type HostedChatFinalizationCommon = {
  streamResult: { steps: PromiseLike<readonly unknown[]> };
  lifecycleAdapter: HostedChatExecutionLifecycleAdapter;
  mirroredToolChunkState: MirroredToolChunkState;
  capturedMessageId: string | null;
  incompleteToolCallsPartErrorText: string;
  cleanup: () => Promise<void>;
  logger?: HostedChatExecutionRuntimeLogger;
  streamError?: unknown | null;
};

export type FinalizeHostedChatRunInput =
  & HostedChatFinalizationCommon
  & (
    | { kind: "response"; responseMessage: ChatUiMessage; isAborted: boolean }
    | { kind: "detached"; isAborted: boolean; mirroredDurableOutput: boolean }
  );
```

If importing `HostedChatExecutionRuntimeLogger` from `chat-execution-runtime.ts` creates a cycle, use a local structural logger type in the private Module:

```ts
type HostedChatFinalizationLogger = {
  error: (message: string, metadata?: Record<string, unknown>) => void;
};
```

## Terminal ordering invariants

Finalization order must stay stable:

1. Read the final step from `streamResult.steps`.
2. Build response or detached final state.
3. For empty-output failure, flush the mirror, dispatch failed terminal state, then cleanup.
4. For non-empty output, append fallback chunks in order.
5. Flush the mirror.
6. Evaluate stream errors after fallback chunks have been appended and the mirror has flushed.
7. Dispatch failed, cancelled, or completed terminal state.
8. Run finalization cleanup after terminal dispatch.
9. Log and suppress cleanup errors during hosted runtime finalization.

Response terminal states preserve metadata from `extractChatMessageMetadata(sanitizedFinalizedMessage.metadata)`.

Detached empty-output failure remains conditional:

```ts
!isAborted && !mirroredDurableOutput && !state.hasContent;
```

Late provider body-read errors remain successful only when output exists and the final step has a completed finish reason:

```ts
function hasFinalStepCompletionSignal(finalStep: unknown): boolean {
  if (
    typeof finalStep !== "object" || finalStep === null ||
    !("finishReason" in finalStep) ||
    typeof finalStep.finishReason !== "string"
  ) {
    return false;
  }

  return hasCompletedStepSignal(finalStep.finishReason);
}
```

## Compatibility contract

Preserve all public `veryfront/agent` exports and signatures. In particular, keep these existing exports reachable through `src/agent/index.ts`:

- hosted chat execution runtime exports from `src/agent/hosted/chat-execution-runtime.ts`
- generic finalization exports from `src/agent/hosted/stream-finalization.ts`
- finalized message exports from `src/agent/hosted/finalized-message.ts`
- terminal-error exports from `src/agent/hosted/stream-terminal-error.ts`
- hosted lifecycle exports from `src/agent/hosted/lifecycle.ts`

Keep these helper functions callable for compatibility:

- `cleanupAfterHostedChatExecutionFinalization`
- `createHostedChatStreamFinalizationHooks`
- `createHostedChatFinalizeResponseBuildState`
- `createHostedChatFinalizeDetachedBuildState`
- `toHostedChatExecutionFinalState`
- `finalizeHostedResponse`
- `finalizeHostedDetached`

The hosted runtime path should stop using the shallow generic finalizer, but the generic finalizer must remain behavior-compatible.

## Behavior to preserve

- Response `onFinish` wins over detached fallback when present.
- `waitForFinish()` runs detached finalization only when response finalization did not start.
- Provider-owned `input-available` Tool parts remain successful.
- Local unfinished Tool parts become `output-error` and terminal failure.
- Empty non-aborted response output fails.
- Empty detached output fails only when no durable output was mirrored.
- Aborted output resolves as cancelled.
- Stream timeout and provider errors keep current terminal mapping.
- Late provider body-read errors can complete when output and completion signals exist.
- Fallback chunks append before mirror flush.
- Terminal dispatch happens after mirror flush.
- Cleanup runs after terminal dispatch and is logged plus suppressed by hosted runtime finalization.
- Root stream watchdog disposal remains in `chat-execution-runtime.ts`.
- Agent run span finalization remains in `chat-execution-runtime.ts` and adjacent lifecycle Modules.
- Public helper behavior remains covered by existing tests.

## Rejected alternatives

- Keep deepening `stream-finalization.ts` as the main Module. Rejected because its generic Interface forces hosted callers to know too much.
- Add a new finalization Adapter layer. Rejected because `HostedChatExecutionLifecycleAdapter` is already the concrete Adapter at this Seam.
- Move response/detached arbitration into the new Module. Rejected because the runtime owns stream lifecycle state, `finishHandlerStarted`, and `finishPromise`.
- Remove public helper shims. Rejected because this is an architecture cleanup, not a public API break.

## Risks

- Public export compatibility can regress if old helper exports are deleted or moved.
- Cleanup behavior can regress if the new Module calls raw `cleanup` without hosted cleanup suppression.
- Detached empty-output behavior can regress because `mirroredDurableOutput` and fallback content are separate signals.
- Stream-error ordering can regress if fallback chunks append after terminal dispatch.
- Late body-read behavior can regress if the final-step finish reason is ignored.
- A type-only cycle can appear if the private Module imports logger types from `chat-execution-runtime.ts`.

## Rollback

Rollback is clean:

1. Restore `chat-execution-runtime.ts` to call `finalizeHostedResponse` and `finalizeHostedDetached`.
2. Delete `src/agent/hosted/hosted-chat-finalization.ts`.
3. Keep all public shims and existing tests untouched.
