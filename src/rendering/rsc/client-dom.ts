import { validateTrustedHtml } from "#veryfront/security/client/html-sanitizer.ts";
import { rscLogger } from "../client/browser-logger.ts";
import { RSC_ROOT_ID } from "./constants.ts";

type SlotMessage = { type: "slot"; id: string; html: string };

const MAX_NDJSON_RECORD_BYTES = 1024 * 1024;

export function getContainer(doc: Document, id: string): HTMLElement {
  const elementId = id === "root" ? RSC_ROOT_ID : `rsc-slot-${id}`;

  const existing = doc.getElementById(elementId);
  if (existing) return existing as HTMLElement;

  const el = doc.createElement("div");
  el.id = elementId;
  doc.body.appendChild(el);
  return el;
}

function applySlotMessage(doc: Document, msg: SlotMessage): void {
  if (msg.type !== "slot") return;

  const el = getContainer(doc, msg.id);
  // Server-rendered RSC HTML is trusted; validateTrustedHtml provides defense-in-depth
  el.innerHTML = validateTrustedHtml(String(msg.html ?? ""));
}

function processNdjsonChunk(doc: Document, buffered: string): string {
  const parts = buffered.split("\n");
  const remainder = parts.pop() ?? "";

  for (const line of parts) {
    const s = line.trim();
    if (!s) continue;

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

    if (!parsed || typeof parsed !== "object") continue;
    const msg = parsed as SlotMessage;
    if (msg.type !== "slot") continue;

    applySlotMessage(doc, msg);
    try {
      hydrateClientBoundaries(doc, msg.id || "root");
    } catch (e) {
      rscLogger.debug("[client-dom] hydration optional failed", e);
    }
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
      buffer = processNdjsonChunk(doc, buffer);
    }

    if (buffer) processNdjsonChunk(doc, `${buffer}\n`);
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

function findClientBoundaries(doc: Document, slotId: string): HTMLElement[] {
  const root = getContainer(doc, slotId);
  const out: HTMLElement[] = [];

  const walker = (node: Element): void => {
    const el = node as HTMLElement;
    if (el.dataset?.clientRef) out.push(el);
    for (const child of node.children) walker(child);
  };

  walker(root);
  return out;
}

function hydrateClientBoundaries(doc: Document, slotId: string): void {
  const nodes = findClientBoundaries(doc, slotId);

  for (const el of nodes) {
    const ref = el.dataset?.clientRef;
    if (!ref) continue;

    // Mark as seen - real hydration happens via hydrate-client.ts after streaming
    el.dataset.hydrated = "true";
    rscLogger.debug("[client-dom] marked for hydration", ref);
  }
}
