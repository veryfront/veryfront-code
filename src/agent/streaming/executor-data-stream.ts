import { createPrivateTextDecoder } from "#veryfront/security/private-text.ts";
import {
  isPrivateUint8Array,
  privateByteLength,
  privateByteSubarray,
  PrivateUint8Array,
  setPrivateBytes,
} from "#veryfront/security/private-bytes.ts";
import { getPrivateStreamReader } from "#veryfront/security/private-stream.ts";
import { privateJsonParse } from "#veryfront/security/private-json.ts";
import { EXECUTOR_MAX_RETAINED_BYTES } from "../executor/protocol.ts";
import {
  EXECUTOR_AGENT_MAX_PAYLOAD_BYTES,
  ExecutorAgentError,
} from "../hosted/executor-agent-schema.ts";
import { parseExecutorDataEvent } from "./executor-data-schema.ts";

const apply = Reflect.apply;
const indexOf = String.prototype.indexOf;
const slice = String.prototype.slice;
const trimStart = String.prototype.trimStart;
const minimum = Math.min;

function parseBlock(block: string) {
  let payload = "";
  for (let offset = 0; offset <= block.length;) {
    const newline = apply(indexOf, block, ["\n", offset]) as number;
    const end = newline === -1 ? block.length : newline;
    if (apply(slice, block, [offset, offset + 5]) !== "data:") {
      throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_STREAM");
    }
    if (offset > 0) payload += "\n";
    payload += apply(trimStart, apply(slice, block, [offset + 5, end]), []);
    if (newline === -1) break;
    offset = end + 1;
  }
  return parseExecutorDataEvent(privateJsonParse(payload));
}

/** @internal Strict bounded SSE reader for the executor's runtime stream. */
export async function* readExecutorDataEvents(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
) {
  const reader = getPrivateStreamReader(stream);
  const validator = createPrivateTextDecoder("utf-8", { fatal: true });
  const decoder = createPrivateTextDecoder("utf-8", { fatal: true });
  let pending = new PrivateUint8Array(4096);
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
        !isPrivateUint8Array(next.value) ||
        privateByteLength(next.value) > EXECUTOR_MAX_RETAINED_BYTES
      ) {
        throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_STREAM");
      }
      // Validate UTF-8 incrementally, including malformed streams that never end.
      // Frame raw bytes once; small chunks never rescan or re-encode a prefix.
      for (let offset = 0; offset < privateByteLength(next.value); offset += 4096) {
        const fragment = privateByteSubarray(next.value, offset, offset + 4096);
        validator.decode(fragment, { stream: true });
        for (let byteIndex = 0; byteIndex < privateByteLength(fragment); byteIndex++) {
          const byte = fragment[byteIndex]!;
          if (terminal) throw new ExecutorAgentError("EXECUTOR_AGENT_INVALID_STREAM");
          if (pendingBytes === privateByteLength(pending)) {
            const grown = new PrivateUint8Array(
              minimum(privateByteLength(pending) * 2, EXECUTOR_AGENT_MAX_PAYLOAD_BYTES + 2),
            );
            setPrivateBytes(grown, pending);
            pending = grown;
          }
          pending[pendingBytes++] = byte;
          if (byte === 10 && pendingBytes >= 2 && pending[pendingBytes - 2] === 10) {
            const block = decoder.decode(privateByteSubarray(pending, 0, pendingBytes), {
              stream: true,
            });
            pendingBytes = 0;
            const event = parseBlock(apply(slice, block, [0, -2]) as string);
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
