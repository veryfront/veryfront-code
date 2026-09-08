import type { ChatMessageMetadata, ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";
import type { ConversationRunEvent } from "../conversation/run-events.ts";
import {
  type ConversationRunProjection,
  getConversationRunProjectionSchema,
} from "../conversation/durable-contracts.ts";
import {
  createConversationHostedTerminalAdapter,
  resolveConversationHostedStreamErrorState,
} from "../conversation/hosted-terminal.ts";
import { createDurableRunEventSink } from "./durable-run-event-sink.ts";
import {
  createHostedConversationRunChunkMirrorFromCapability,
  createHostedRunEventWriterCapability,
} from "./child-run-event-writer-token.ts";
import {
  createToolExposureCheckpointEvent,
  type ToolExposureCheckpoint,
} from "../runtime/tool-exposure.ts";
import {
  createProviderReplayCheckpointEvent,
  type ProviderReplayCheckpoint,
} from "../runtime/provider-replay.ts";
import type { AgentRunEventSink } from "#veryfront/runtime/model-call-context.ts";

/** Acknowledging output writes and terminal finalization for a canonical run. */
export interface ManagedBrokerOutput {
  write(chunk: ChatUiMessageChunk<ChatMessageMetadata>): Promise<void>;
  finish(input: { completed: boolean; error?: unknown }): Promise<void>;
}

/** Create exact-run API persistence callbacks while retaining credentials in the broker. */
export function createManagedBrokerPersistence(input: {
  apiUrl: string;
  runEventToken: string;
  run: ConversationRunProjection;
  modelId: string;
  resolveProvider(modelId: string): string;
  fetch?: typeof globalThis.fetch;
}) {
  const run = getConversationRunProjectionSchema().parse(input.run);
  if (run.status !== "pending" && run.status !== "running" && run.status !== "waiting_for_tool") {
    throw new TypeError("Managed broker persistence requires an active run");
  }
  const capability = createHostedRunEventWriterCapability({
    apiUrl: input.apiUrl,
    runId: run.runId,
    runEventAppendToken: input.runEventToken,
    fetch: input.fetch,
  });
  const mirror = createHostedConversationRunChunkMirrorFromCapability(capability, {
    expectedRunId: run.runId,
    conversationId: run.conversationId,
    latestEventId: run.latestEventId,
    latestExternalEventSequence: run.latestExternalEventSequence,
  });
  if (!mirror) throw new TypeError("Managed broker run-event capability is not bound");
  const durableMirror = mirror;
  const terminal = createConversationHostedTerminalAdapter({
    authToken: input.runEventToken,
    apiUrl: input.apiUrl,
    run,
    fallbackModelId: input.modelId,
    resolveProvider: input.resolveProvider,
  });
  const durableSink = createDurableRunEventSink({ mirror: durableMirror });
  let tail = Promise.resolve();
  let failure: unknown;
  let failed = false;
  let finished = false;
  let cleaned = false;

  const queue = <T>(operation: () => Promise<T>, terminal = false): Promise<T> => {
    if (cleaned) return Promise.reject(new TypeError("Managed broker persistence is closed"));
    if (finished && !terminal) {
      return Promise.reject(new TypeError("Managed broker persistence is finished"));
    }
    const current = tail.then(async () => {
      if (failed) throw failure;
      try {
        return await operation();
      } catch (error) {
        failure = error;
        failed = true;
        throw error;
      }
    });
    tail = current.then(() => undefined, () => undefined);
    return current;
  };
  const flush = async () => {
    const snapshot = await durableMirror.flush({ throwOnTimeoutRetry: true });
    if (snapshot.disabled || snapshot.pendingEventCount > 0 || snapshot.inFlight) {
      throw new TypeError("Managed broker output was not durably persisted");
    }
  };
  const persistEvents = (events: ConversationRunEvent[]) =>
    queue(async () => {
      await durableMirror.appendEvents(events);
      await flush();
    });
  const modelRunEventSink: AgentRunEventSink = (event) =>
    queue(async () => await durableSink(event));
  const output: ManagedBrokerOutput = {
    write(chunk) {
      if (finished) return Promise.reject(new TypeError("Managed broker output is finished"));
      return queue(async () => {
        await durableMirror.handleChunk(chunk);
        await flush();
      });
    },
    finish(result) {
      if (finished) return Promise.reject(new TypeError("Managed broker output is finished"));
      if (result.completed && result.error !== undefined) {
        return Promise.reject(new TypeError("Completed managed output cannot carry an error"));
      }
      finished = true;
      return queue(async () => {
        await flush();
        if (result.completed) {
          await terminal.dispatch({ status: "completed" });
        } else if (result.error !== undefined) {
          await terminal.dispatch(resolveConversationHostedStreamErrorState(result.error));
        } else {
          await terminal.dispatch({
            status: "cancelled",
            terminalErrorCode: "ABORTED",
            terminalErrorMessage: "Managed executor output was cancelled",
          });
        }
      }, true);
    },
  };
  async function cleanup(): Promise<void> {
    if (cleaned) return;
    cleaned = true;
    await tail;
    durableMirror.dispose();
  }
  return {
    modelRunEventSink,
    publishParentRunEvents: persistEvents,
    persistToolExposureCheckpoint: (checkpoint: ToolExposureCheckpoint) =>
      persistEvents([createToolExposureCheckpointEvent(checkpoint)]),
    persistProviderReplayCheckpoint: (checkpoint: ProviderReplayCheckpoint) =>
      persistEvents([createProviderReplayCheckpointEvent(checkpoint)]),
    output,
    cleanup,
  };
}
