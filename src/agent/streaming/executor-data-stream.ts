import { EXECUTOR_MAX_RETAINED_BYTES } from "../executor/protocol.ts";
import {
  EXECUTOR_AGENT_MAX_PAYLOAD_BYTES,
  ExecutorAgentError,
} from "../hosted/executor-agent-schema.ts";
import { parseExecutorDataEvent } from "./executor-data-schema.ts";

const textEncoder = new TextEncoder();

/** @internal Strict bounded SSE reader for the executor's runtime stream. */
export async function* readExecutorDataEvents(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "";
  let terminal = false;
  let completed = false;
  // Only the first cancel promise includes asynchronous source cleanup.
  let cancellation: Promise<void> | undefined;
  const cancel = () => {
    if (!cancellation) {
      cancellation = reader.cancel();
      void cancellation.catch(() => {});
    }
    return cancellation;
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      if (
        !(next.value instanceof Uint8Array) || next.value.byteLength > EXECUTOR_MAX_RETAINED_BYTES
      ) {
        throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_STREAM");
      }
      // Process bounded slices even when the local producer coalesces many events.
      for (let offset = 0; offset < next.value.byteLength; offset += 4096) {
        pending += decoder.decode(next.value.subarray(offset, offset + 4096), { stream: true });
        let separator: number;
        while ((separator = pending.indexOf("\n\n")) !== -1) {
          const block = pending.slice(0, separator);
          pending = pending.slice(separator + 2);
          if (textEncoder.encode(block).byteLength > EXECUTOR_AGENT_MAX_PAYLOAD_BYTES) {
            throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_STREAM");
          }
          const lines = block.split("\n");
          if (!lines.length || lines.some((line) => !line.startsWith("data:"))) {
            throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_STREAM");
          }
          const event = parseExecutorDataEvent(
            JSON.parse(lines.map((line) => line.slice(5).trimStart()).join("\n")),
          );
          terminal ||= event.type === "message-finish" || event.type === "finish" ||
            event.type === "error";
          yield event;
        }
        if (textEncoder.encode(pending).byteLength > EXECUTOR_AGENT_MAX_PAYLOAD_BYTES) {
          throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_STREAM");
        }
      }
    }
    pending += decoder.decode();
    if (pending.length > 0 || !terminal) {
      throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_STREAM");
    }
    completed = true;
  } catch (error) {
    if (signal.aborted) throw new ExecutorAgentError("ABORTED");
    if (error instanceof ExecutorAgentError) throw error;
    throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_STREAM");
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!completed) await cancel().catch(() => {});
    reader.releaseLock();
  }
}
