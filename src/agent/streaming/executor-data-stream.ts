import { getPrivateStreamReader } from "#veryfront/security/private-stream.ts";
import { privateJsonParse } from "#veryfront/security/private-json.ts";
import { EXECUTOR_MAX_RETAINED_BYTES } from "../executor/protocol.ts";
import {
  EXECUTOR_AGENT_MAX_PAYLOAD_BYTES,
  ExecutorAgentError,
} from "../hosted/executor-agent-schema.ts";
import { parseExecutorDataEvent } from "./executor-data-schema.ts";

function parseBlock(block: string) {
  const lines = block.split("\n");
  if (!lines.length || lines.some((line) => !line.startsWith("data:"))) {
    throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_STREAM");
  }
  return parseExecutorDataEvent(
    privateJsonParse(lines.map((line) => line.slice(5).trimStart()).join("\n")),
  );
}

/** @internal Strict bounded SSE reader for the executor's runtime stream. */
export async function* readExecutorDataEvents(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
) {
  const reader = getPrivateStreamReader(stream);
  const validator = new TextDecoder("utf-8", { fatal: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = new Uint8Array(4096);
  let pendingBytes = 0;
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
      // Validate UTF-8 incrementally, including malformed streams that never end.
      // Frame raw bytes once; small chunks never rescan or re-encode a prefix.
      for (let offset = 0; offset < next.value.byteLength; offset += 4096) {
        const fragment = next.value.subarray(offset, offset + 4096);
        validator.decode(fragment, { stream: true });
        for (const byte of fragment) {
          if (terminal) throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_STREAM");
          if (pendingBytes === pending.length) {
            const grown = new Uint8Array(
              Math.min(pending.length * 2, EXECUTOR_AGENT_MAX_PAYLOAD_BYTES + 2),
            );
            grown.set(pending);
            pending = grown;
          }
          pending[pendingBytes++] = byte;
          if (byte === 10 && pendingBytes >= 2 && pending[pendingBytes - 2] === 10) {
            const block = decoder.decode(pending.subarray(0, pendingBytes), { stream: true });
            pendingBytes = 0;
            const event = parseBlock(block.slice(0, -2));
            terminal ||= event.type === "message-finish" || event.type === "error";
            yield event;
          } else if (pendingBytes > EXECUTOR_AGENT_MAX_PAYLOAD_BYTES + (byte === 10 ? 1 : 0)) {
            throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_STREAM");
          }
        }
      }
    }
    validator.decode();
    if (pendingBytes > 0 || !terminal) {
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
