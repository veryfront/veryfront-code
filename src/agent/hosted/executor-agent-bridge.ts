import { encodePrivateText } from "#veryfront/security/private-text.ts";
import {
  cancelPrivateStream,
  createPrivateReadableStream,
  isPrivateStreamLocked,
} from "#veryfront/security/private-stream.ts";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import type { ExecutorChannel, ExecutorOperation } from "../executor/channel.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import type { ChatUiMessageChunk } from "#veryfront/chat/types.ts";
import { createChatUiMessageStreamFromDataStream } from "../streaming/chat-ui-message-stream.ts";
import { readExecutorDataEvents } from "../streaming/executor-data-stream.ts";
import {
  getExecutorAgentStreamFrameSchema,
  parseExecutorDataEvent,
} from "../streaming/executor-data-schema.ts";
import type {
  HostedChatRuntimeAgent,
  HostedChatRuntimeStreamInput,
} from "./chat-runtime-contract.ts";
import {
  ExecutorAgentError,
  executorAgentFailureCode,
  executorAgentJson,
  getExecutorAgentStreamInputSchema,
  getExecutorPreparedRuntimeHandleSchema,
  parseExecutorAgentData,
} from "./executor-agent-schema.ts";

const MapConstructor = Map;
const mapSet = Map.prototype.set;
const apply = Reflect.apply;

async function startExecutorRuntimeStream(
  start: () => Promise<ReadableStream<Uint8Array>>,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  signal.throwIfAborted();
  // The channel notifies the caller of cancellation immediately, but keeps
  // admission until this handler settles. Never detach unfinished setup from
  // that lifetime; a noncooperative setup is fenced by the handler deadline.
  const stream = await start();
  if (signal.aborted) {
    await cancelPrivateStream(stream).catch(() => {});
    throw new ExecutorAgentError("ABORTED");
  }
  return stream;
}

/** @internal Install in an executor with one already-prepared runtime. No Agent or credential crosses the channel. */
export function createExecutorAgentOperations(options: {
  preparedRuntimeHandle: string;
  startStream: (input: HostedChatRuntimeStreamInput) => Promise<ReadableStream<Uint8Array>>;
  /** Executor-local runtime cleanup only. The broker owns channel/allocation disposal. */
  cleanup?: () => Promise<void>;
}): ReadonlyMap<string, ExecutorOperation> {
  const handle = parseExecutorAgentData(
    getExecutorPreparedRuntimeHandleSchema(),
    options.preparedRuntimeHandle,
  );
  let started = false;
  const streamOperation: ExecutorOperation = {
    mode: "stream",
    async *handle(value, context) {
      let phase: "setup" | "stream" = "setup";
      let ownsRuntime = false;
      let failure: JsonValue | undefined;
      let stream: ReadableStream<Uint8Array> | undefined;
      try {
        const request = parseExecutorAgentData(getExecutorAgentStreamInputSchema(), value);
        executorAgentJson(request, "EXECUTOR_AGENT_INPUT_TOO_LARGE");
        if (request.preparedRuntimeHandle !== handle) {
          throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_INPUT");
        }
        if (started) throw new ExecutorAgentError("EXECUTOR_AGENT_ALREADY_STARTED");
        started = true;
        ownsRuntime = true;
        context.signal.throwIfAborted();
        stream = await startExecutorRuntimeStream(
          () => options.startStream({ messages: request.messages, abortSignal: context.signal }),
          context.signal,
        );
        phase = "stream";
        yield { type: "ready" };
        for await (const event of readExecutorDataEvents(stream, context.signal)) {
          yield executorAgentJson({ type: "event", event }, "EXECUTOR_AGENT_INVALID_STREAM");
        }
      } catch (error) {
        failure = {
          type: "failure",
          phase,
          code: context.signal.aborted ? "ABORTED" : executorAgentFailureCode(
            error,
            phase === "setup" ? "EXECUTOR_AGENT_SETUP_FAILED" : "EXECUTOR_AGENT_STREAM_FAILED",
          ),
        };
      } finally {
        // A return while suspended at ready can precede acquisition of the
        // SSE reader. Close that unconsumed source as well as the runtime.
        if (stream && !isPrivateStreamLocked(stream)) {
          await cancelPrivateStream(stream).catch(() => {});
        }
        if (ownsRuntime) {
          try {
            await options.cleanup?.();
          } catch {
            failure ??= { type: "failure", phase, code: "EXECUTOR_AGENT_STREAM_FAILED" };
          }
        }
      }
      context.signal.throwIfAborted();
      yield failure ?? { type: "complete" };
    },
  };
  const operations = new MapConstructor<string, ExecutorOperation>();
  apply(mapSet, operations, ["agent.stream", streamOperation]);
  return operations;
}

function parseFrame(value: unknown) {
  const result = getExecutorAgentStreamFrameSchema().safeParse(value);
  if (!result.success) throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_STREAM");
  return result.data;
}

/** @internal Proxy one prepared runtime while keeping UI conversion and finish persistence in the broker. */
export function createExecutorHostedChatRuntimeAgent(options: {
  channel: ExecutorChannel;
  preparedRuntimeHandle: string;
  timeoutMs?: number;
}): HostedChatRuntimeAgent {
  const handle = parseExecutorAgentData(
    getExecutorPreparedRuntimeHandleSchema(),
    options.preparedRuntimeHandle,
  );
  let started = false;
  return {
    async stream(input) {
      let opening: AsyncIterableIterator<JsonValue> | undefined;
      try {
        if (started) throw new ExecutorAgentError("EXECUTOR_AGENT_ALREADY_STARTED");
        const request = parseExecutorAgentData(getExecutorAgentStreamInputSchema(), {
          preparedRuntimeHandle: handle,
          messages: input.messages,
        });
        const payload = executorAgentJson(request, "EXECUTOR_AGENT_INPUT_TOO_LARGE");
        input.abortSignal.throwIfAborted();
        started = true;
        opening = options.channel.stream("agent.stream", payload, {
          signal: input.abortSignal,
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        });
        const first = await opening.next();
        if (first.done) throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_STREAM");
        const frame = parseFrame(first.value);
        if (frame.type === "failure") throw new ExecutorAgentError(frame.code);
        if (frame.type !== "ready") throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_STREAM");
      } catch (error) {
        const release = opening?.return?.();
        if (input.abortSignal.aborted) {
          // Respond without waiting for cancellation acknowledgement. The
          // channel retains admission and applies the cleanup deadline.
          void release?.catch(() => {});
        } else {
          await release?.catch(() => {});
        }
        throw error instanceof ExecutorAgentError ? error : new ExecutorAgentError(
          input.abortSignal.aborted ? "ABORTED" : "EXECUTOR_AGENT_SETUP_FAILED",
        );
      }
      const iterator = opening;
      let consumed = false;
      return {
        steps: Promise.resolve([]),
        toUIMessageStream(streamOptions = {}) {
          if (consumed) throw new ExecutorAgentError("EXECUTOR_AGENT_ALREADY_STARTED");
          consumed = true;
          let terminal = false;
          const stream = createPrivateReadableStream<Uint8Array>({
            async pull(controller) {
              try {
                const next = await iterator.next();
                if (next.done) throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_STREAM");
                const frame = parseFrame(next.value);
                if (frame.type === "event") {
                  if (terminal) throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_STREAM");
                  const event = parseExecutorDataEvent(frame.event);
                  terminal ||= event.type === "message-finish" || event.type === "error";
                  controller.enqueue(
                    encodePrivateText(`data: ${privateJsonStringify(event)}\n\n`),
                  );
                } else if (frame.type === "complete") {
                  if (!terminal || !(await iterator.next()).done) {
                    throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_STREAM");
                  }
                  controller.close();
                } else if (frame.type === "failure") {
                  throw new ExecutorAgentError(frame.code);
                } else throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_STREAM");
              } catch (error) {
                await iterator.return?.().catch(() => {});
                controller.error(
                  error instanceof ExecutorAgentError ? error : new ExecutorAgentError(
                    input.abortSignal.aborted ? "ABORTED" : "EXECUTOR_AGENT_STREAM_FAILED",
                  ),
                );
              }
            },
            async cancel() {
              await iterator.return?.().catch(() => {});
            },
          }, { highWaterMark: 0 });
          try {
            const chunks = createChatUiMessageStreamFromDataStream({ stream }, streamOptions)
              [Symbol.asyncIterator]();
            const uiIterator: AsyncIterableIterator<ChatUiMessageChunk> = {
              [Symbol.asyncIterator]() {
                return this;
              },
              next: () => chunks.next(),
              async return() {
                // Cancel before awaiting the converter: it may not have started,
                // or its current next() may still be waiting for remote output.
                await iterator.return?.().catch(() => {});
                return await chunks.return?.() ?? { done: true, value: undefined };
              },
            };
            return uiIterator;
          } catch (error) {
            void iterator.return?.().catch(() => {});
            throw error;
          }
        },
      };
    },
  };
}
