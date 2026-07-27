import { validateTrustedHtml } from "#veryfront/security/client/html-sanitizer.ts";
import { rscLogger } from "../client/browser-logger.ts";
import { isValidRscSlotId, MAX_RSC_CLIENT_SLOTS } from "./client-transport.ts";
import { RSC_ROOT_ID } from "./constants.ts";

type SlotMessage = { type: "slot"; id: string; html: string };

const MAX_NDJSON_RECORD_BYTES = 1024 * 1024;
const MAX_NDJSON_RECORDS = 10_000;

interface NdjsonStreamState {
  records: number;
  readonly slotIds: Set<string>;
}

export function getContainer(doc: Document, id: string): HTMLElement {
  if (!isValidRscSlotId(id)) {
    throw new TypeError("RSC slot id must be a bounded canonical identifier");
  }
  const elementId = id === "root" ? RSC_ROOT_ID : `rsc-slot-${id}`;

  const existing = doc.getElementById(elementId);
  if (existing) return existing as HTMLElement;

  const el = doc.createElement("div");
  el.id = elementId;
  doc.body.appendChild(el);
  return el;
}

function applySlotMessage(
  doc: Document,
  msg: SlotMessage,
  state: NdjsonStreamState,
): void {
  if (!state.slotIds.has(msg.id)) {
    if (state.slotIds.size >= MAX_RSC_CLIENT_SLOTS) {
      throw new RangeError(
        `RSC NDJSON slot limit of ${MAX_RSC_CLIENT_SLOTS} was exceeded`,
      );
    }
    state.slotIds.add(msg.id);
  }
  const el = getContainer(doc, msg.id);
  // Server-rendered RSC HTML is trusted; validateTrustedHtml provides defense-in-depth
  el.innerHTML = validateTrustedHtml(msg.html);
}

function parseSlotMessage(value: unknown): SlotMessage | null {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    candidate.type !== "slot" ||
    !isValidRscSlotId(candidate.id) ||
    typeof candidate.html !== "string"
  ) {
    return null;
  }

  return {
    type: "slot",
    id: candidate.id,
    html: candidate.html,
  };
}

function processNdjsonChunk(
  doc: Document,
  buffered: string,
  state: NdjsonStreamState,
): string {
  const parts = buffered.split("\n");
  const remainder = parts.pop() ?? "";

  for (const line of parts) {
    const s = line.trim();
    if (!s) continue;
    state.records++;
    if (state.records > MAX_NDJSON_RECORDS) {
      throw new RangeError(
        `RSC NDJSON record limit of ${MAX_NDJSON_RECORDS} was exceeded`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(s);
    } catch (e) {
      rscLogger.debug("[client-dom] malformed NDJSON line", {
        line: s,
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    const msg = parseSlotMessage(parsed);
    if (!msg) continue;
    applySlotMessage(doc, msg, state);
  }

  return remainder;
}

function createAbortWaiter(signal: AbortSignal): {
  promise: Promise<never>;
  dispose: () => void;
} {
  let listening = false;
  let abortListener: (() => void) | undefined;

  const promise = new Promise<never>((_, reject) => {
    const abort = (): void => reject(new DOMException("aborted", "AbortError"));
    abortListener = abort;

    if (signal.aborted) {
      abort();
      return;
    }

    listening = true;
    signal.addEventListener("abort", abort, { once: true });
  });

  return {
    promise,
    dispose: () => {
      if (!listening || !abortListener) return;
      signal.removeEventListener("abort", abortListener);
      listening = false;
    },
  };
}

function countBufferedRecordBytes(chunk: Uint8Array, initialCount: number): number {
  let count = initialCount;
  for (const byte of chunk) {
    if (byte === 0x0a) {
      count = 0;
      continue;
    }
    count++;
    if (count > MAX_NDJSON_RECORD_BYTES) {
      throw new Error(
        `RSC NDJSON buffer limit exceeded (${MAX_NDJSON_RECORD_BYTES} bytes)`,
      );
    }
  }
  return count;
}

export async function consumeNdjsonStream(
  input: Response | ReadableStream<Uint8Array>,
  doc: Document = document,
  signal?: AbortSignal,
): Promise<void> {
  const response = "body" in input ? input : null;
  const stream = response?.body ?? (input as ReadableStream<Uint8Array>);
  if (!stream) return;

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bufferedRecordBytes = 0;
  let streamFinished = false;
  const state: NdjsonStreamState = {
    records: 0,
    slotIds: new Set(),
  };
  const abortWaiter = signal ? createAbortWaiter(signal) : undefined;

  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");

      const readPromise = reader.read();
      const { done, value } = signal
        ? await Promise.race([readPromise, abortWaiter!.promise])
        : await readPromise;

      if (done) {
        streamFinished = true;
        buffer += decoder.decode();
        break;
      }

      if (!value) continue;
      bufferedRecordBytes = countBufferedRecordBytes(value, bufferedRecordBytes);
      buffer += decoder.decode(value, { stream: true });
      buffer = processNdjsonChunk(doc, buffer, state);
    }

    if (buffer) processNdjsonChunk(doc, `${buffer}\n`, state);
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw e;
    rscLogger.debug("[client-dom] consumeNdjsonStream error", e);
    throw e;
  } finally {
    abortWaiter?.dispose();

    if (!streamFinished) {
      try {
        await reader.cancel();
      } catch (e) {
        rscLogger.debug("[client-dom] reader.cancel failed", e);
      }
    }

    try {
      reader.releaseLock();
    } catch (e) {
      rscLogger.debug("[client-dom] reader.releaseLock failed", e);
    }
  }
}
